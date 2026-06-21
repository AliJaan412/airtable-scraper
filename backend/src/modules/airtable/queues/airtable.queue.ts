import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient } from '../../../common/redis';
import { AirtableService } from '../services/airtable.service';

const QUEUE_NAME = 'airtable-sync';

// 2 attempts — sync is expensive, don't retry too aggressively
const JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 50 },
};

let airtableQueue: Queue | null = null;
let airtableWorker: Worker | null = null;

export function getAirtableQueue(): Queue {
  if (!airtableQueue) {
    airtableQueue = new Queue(QUEUE_NAME, { connection: getRedisClient() as any });
  }
  return airtableQueue;
}

export async function enqueueAirtableSyncJob(organizationId: string): Promise<string> {
  try {
    const job = await getAirtableQueue().add(
      'sync-all',
      { organizationId },
      {
        ...JOB_OPTS,
        // Fixed jobId per org — prevents duplicate syncs running simultaneously
        jobId: `airtable-sync:${organizationId}`,
      },
    );
    return job.id ?? organizationId;
  } catch (err: any) {
    console.warn('[AirtableQueue] Redis unavailable — running sync inline (no retry):', err.message);
    AirtableService.syncAll(organizationId).catch((e) => {
      console.error('[AirtableQueue] inline fallback error:', e.message);
    });
    return organizationId;
  }
}

export async function getAirtableSyncStatus(organizationId: string): Promise<{ state: string; result?: any; failedReason?: string } | null> {
  try {
    const job = await Job.fromId(getAirtableQueue(), `airtable-sync:${organizationId}`);
    if (!job) return null;
    const state = await job.getState();
    return {
      state,
      result: state === 'completed' ? job.returnvalue : undefined,
      failedReason: state === 'failed' ? job.failedReason : undefined,
    };
  } catch {
    return null;
  }
}

export function startAirtableWorker(): Worker {
  if (airtableWorker) return airtableWorker;

  airtableWorker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ organizationId: string }>) => {
      const { organizationId } = job.data;
      console.log(`[AirtableWorker] starting sync job ${job.id} for org ${organizationId} (attempt ${job.attemptsMade + 1})`);
      const counts = await AirtableService.syncAll(organizationId);
      console.log(`[AirtableWorker] sync complete for org ${organizationId}:`, counts);
      return counts;
    },
    {
      connection: getRedisClient() as any,
      concurrency: 3, // allow 3 orgs to sync in parallel
    },
  );

  airtableWorker.on('completed', (job) => {
    console.log(`[AirtableWorker] job ${job.id} completed`);
  });

  airtableWorker.on('failed', (job, err) => {
    console.error(`[AirtableWorker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });

  airtableWorker.on('error', (err) => {
    console.error('[AirtableWorker] worker error:', err.message);
  });

  return airtableWorker;
}

export async function closeAirtableQueue(): Promise<void> {
  await airtableWorker?.close();
  await airtableQueue?.close();
  airtableWorker = null;
  airtableQueue = null;
}
