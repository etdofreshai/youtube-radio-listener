#!/usr/bin/env tsx
/**
 * song-explorations — YouTube radio discovery pipeline
 *
 * Usage:
 *   tsx src/index.ts              # full pipeline: discover → filter → import
 *   tsx src/index.ts discover     # discover + filter only (no import)
 *   tsx src/index.ts import       # import pending accepted candidates
 *   tsx src/index.ts status       # show library stats
 *   tsx src/index.ts cron         # print OpenClaw cron setup instructions
 */
import { loadConfig } from './config.js';
import { Store } from './data/store.js';
import { DedupeSet } from './utils/dedupe.js';
import { log, setLogLevel } from './utils/logger.js';
import { discoverCandidates } from './pipeline/discover.js';
import { filterCandidates } from './pipeline/filter.js';
import { importAcceptedCandidates } from './pipeline/importer.js';
import { checkSchedule, getCronInstructions } from './pipeline/scheduler.js';
import { MockYouTubeAdapter } from './adapters/mock-youtube.js';
import { LiveYouTubeAdapter } from './adapters/youtube.js';
import type { YouTubeAdapter, RunLogEntry } from './types.js';
import { randomUUID } from 'crypto';

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const command = process.argv[2] ?? 'full';
  log.info(`song-explorations | mode=${config.mode} | command=${command}`);

  // Initialize store
  const store = new Store(config.dataDir);

  // Pick adapter
  const adapter: YouTubeAdapter = config.mode === 'dry-run'
    ? new MockYouTubeAdapter()
    : new LiveYouTubeAdapter(config.youtubeApiKey);

  switch (command) {
    case 'discover':
      await runDiscover(adapter, store, config);
      break;
    case 'import':
      runImport(store, config);
      break;
    case 'status':
      showStatus(store, config);
      break;
    case 'cron':
      console.log(getCronInstructions(process.cwd()));
      break;
    case 'full':
    default:
      await runFull(adapter, store, config);
      break;
  }

  store.save();
}

async function runDiscover(adapter: YouTubeAdapter, store: Store, config: any) {
  const schedule = checkSchedule(store, config);
  if (!schedule.canRunDiscovery) {
    log.info(`Skipping discovery — last run was ${schedule.minutesSinceLastRun} min ago (interval: ${config.discoveryIntervalMinutes} min)`);
    return;
  }

  const dedupe = new DedupeSet(store.getSeenVideoIds());
  // Also mark existing tracks as seen
  for (const track of store.getTracks()) {
    dedupe.markSeen(track.videoId);
  }

  const seedVideoIds = store.getSeedVideoIds();
  log.info(`Using ${seedVideoIds.length} seed tracks for discovery`);

  const candidates = await discoverCandidates(adapter, dedupe, seedVideoIds, config);
  const scored = filterCandidates(candidates, config);

  // Store candidates with their scores
  for (const c of scored) {
    store.addCandidate(c);
  }

  // Commit seen set
  dedupe.commit();
  store.setSeenVideoIds(dedupe.allIds());

  const accepted = scored.filter(c => c.decision?.action === 'accept');
  const rejected = scored.filter(c => c.decision?.action === 'reject');
  log.info(`Scored ${scored.length} candidates: ${accepted.length} accepted, ${rejected.length} rejected`);

  // Log details for accepted
  for (const c of accepted) {
    log.info(`  ✓ ${c.title} (${c.videoId}) — score ${c.scoring?.score}`);
  }
  for (const c of rejected) {
    log.debug(`  ✗ ${c.title} (${c.videoId}) — score ${c.scoring?.score}: ${c.decision?.reason}`);
  }
}

function runImport(store: Store, config: any) {
  const pending = store.getPendingCandidates();
  const accepted = store.getAcceptedCandidates().filter(c => !store.getTrack(c.videoId));

  log.info(`Import: ${accepted.length} accepted candidates ready, ${pending.length} pending`);

  if (accepted.length === 0) {
    log.info('Nothing to import');
    return;
  }

  const result = importAcceptedCandidates(
    store.getCandidates().filter(c => c.decision?.action === 'accept'),
    store,
    config,
  );

  log.info(`Import complete: ${result.imported.length} imported, ${result.skipped.length} skipped`);
  if (result.cappedOut) {
    log.warn('Hourly import cap was reached');
  }
}

async function runFull(adapter: YouTubeAdapter, store: Store, config: any) {
  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  log.info(`── Run ${runId} starting ──`);

  // Discovery
  await runDiscover(adapter, store, config);

  // Import
  runImport(store, config);

  // Log run
  const accepted = store.getCandidates().filter(c => c.decision?.action === 'accept');
  const rejected = store.getCandidates().filter(c => c.decision?.action === 'reject');

  const entry: RunLogEntry = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    candidatesDiscovered: accepted.length + rejected.length,
    candidatesAccepted: accepted.length,
    candidatesRejected: rejected.length,
  };
  store.addRunLog(entry);

  log.info(`── Run ${runId} complete ──`);
}

function showStatus(store: Store, config: any) {
  const tracks = store.getTracks();
  const candidates = store.getCandidates();
  const schedule = checkSchedule(store, config);

  console.log('\n═══ song-explorations status ═══\n');
  console.log(`Mode:           ${config.mode}`);
  console.log(`Tracks:         ${tracks.length}`);
  console.log(`Candidates:     ${candidates.length} total`);
  console.log(`  Accepted:     ${candidates.filter(c => c.decision?.action === 'accept').length}`);
  console.log(`  Rejected:     ${candidates.filter(c => c.decision?.action === 'reject').length}`);
  console.log(`  Pending:      ${candidates.filter(c => !c.decision).length}`);
  console.log(`Seen IDs:       ${store.getSeenVideoIds().length}`);
  console.log(`\nSchedule:`);
  console.log(`  Last run:     ${schedule.lastRunAt ?? 'never'}`);
  console.log(`  Can discover: ${schedule.canRunDiscovery}`);
  console.log(`  Imported/hr:  ${schedule.tracksImportedThisHour}/${config.hourlyImportCap}`);
  console.log(`  Cap remain:   ${schedule.importCapRemaining}`);

  if (tracks.length > 0) {
    const sorted = [...tracks].sort((a, b) => b.plays - a.plays);
    console.log(`\nTop tracks by plays:`);
    for (const t of sorted.slice(0, 10)) {
      console.log(`  ${t.plays}× ${t.title} (${t.videoId})`);
    }
  }

  console.log('');
}

main().catch(err => {
  log.error('Fatal error:', err);
  process.exit(1);
});
