import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { getRedisClient } from '../../common/redis';
import { ScraperService } from './scraper.service';

const QUEUE_NAME = 'scraper';

// Retry config: 3 attempts with exponential backoff (10s, 40s, 90s)
const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 100 },
};

let scraperQueue: Queue | null = null;
let scraperWorker: Worker | null = null;

export function getScraperQueue(): Queue {
  if (!scraperQueue) {
    scraperQueue = new Queue(QUEUE_NAME, { connection: getRedisClient() });
  }
  return scraperQueue;
}

export async function enqueueScraperJob(organizationId: string, sessionId: string): Promise<string> {
  try {
    const job = await getScraperQueue().add(
      'run-scraper',
      { organizationId, sessionId },
      JOB_OPTS, // no fixed jobId — each run gets a unique ID so re-runs are not deduplicated
    );
    return job.id ?? sessionId;
  } catch (err: any) {
    console.warn('[ScraperQueue] Redis unavailable — running job inline (no retry):', err.message);
    // Graceful fallback: run inline without queue
    ScraperService.runScraper(organizationId, sessionId).catch((e) => {
      console.error('[ScraperQueue] inline fallback error:', e.message);
    });
    return sessionId;
  }
}

export function startScraperWorker(): Worker {
  if (scraperWorker) return scraperWorker;

  scraperWorker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ organizationId: string; sessionId: string }>) => {
      const { organizationId, sessionId } = job.data;
      console.log(`[ScraperWorker] starting job ${job.id} for session ${sessionId} (attempt ${job.attemptsMade + 1})`);
      await ScraperService.runScraper(organizationId, sessionId);
    },
    {
      connection: getRedisClient(),
      concurrency: 2, // max 2 scraper jobs in parallel
    },
  );

  scraperWorker.on('completed', (job) => {
    console.log(`[ScraperWorker] job ${job.id} completed`);
  });

  scraperWorker.on('failed', (job, err) => {
    console.error(`[ScraperWorker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  scraperWorker.on('error', (err) => {
    console.error('[ScraperWorker] worker error:', err.message);
  });

  return scraperWorker;
}

export async function closeScraperQueue(): Promise<void> {
  await scraperWorker?.close();
  await scraperQueue?.close();
  scraperWorker = null;
  scraperQueue = null;
}
