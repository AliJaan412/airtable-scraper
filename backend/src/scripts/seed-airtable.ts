/**
 * Seed script — creates 200 tickets in Airtable with initial data only.
 * No updates are made — change Status/Assignee manually in Airtable to generate revision history.
 * Usage:
 *   npm run seed
 *
 * Requirements:
 *   - Backend .env must have valid AIRTABLE_* credentials
 *   - MongoDB must be running with a valid access token already stored
 *   - Table must have fields: Title (text), Status (single select), Priority (single select)
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import axios from 'axios';
import { config } from '../config';
import { AirtableConnectionModel } from '../modules/airtable/schemas/airtable-connection.schema';
import { AirtableBaseModel } from '../modules/airtable/schemas/airtable-base.schema';
import { AirtableTableModel } from '../modules/airtable/schemas/airtable-table.schema';

const TOTAL_RECORDS = 200;
const BATCH_SIZE = 10;
const ORG_ID = config.defaultOrgId;

const STATUSES = ['Open', 'In Progress', 'On Hold', 'Pending Review'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const TITLES = [
  'Fix login page redirect issue',
  'Update dashboard charts',
  'Integrate payment gateway',
  'Performance optimization for search',
  'Fix email notification delay',
  'Add export to CSV feature',
  'Update user profile settings',
  'Resolve database connection timeout',
  'Implement dark mode support',
  'Fix mobile responsive layout',
  'Add two-factor authentication',
  'Update API rate limiting',
  'Fix broken image uploads',
  'Improve error messages UI',
  'Add bulk delete functionality',
  'Implement audit trail logging',
  'Fix date timezone display bug',
  'Update third-party integrations',
  'Add advanced search filters',
  'Fix memory leak in background jobs',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAccessToken(): Promise<string> {
  const conn = await AirtableConnectionModel.findOne({ organizationId: ORG_ID });
  if (!conn || !conn.accessToken) {
    throw new Error('No Airtable connection found. Please connect Airtable via the UI first.');
  }
  if (conn.expiresAt && conn.expiresAt <= new Date()) {
    throw new Error('Access token is expired. Please reconnect Airtable via the UI.');
  }
  return conn.accessToken;
}

async function getFirstBaseAndTable(): Promise<{ baseId: string; tableId: string; tableName: string }> {
  const base = await AirtableBaseModel.findOne({ organizationId: ORG_ID });
  if (!base) throw new Error('No bases found. Please sync bases first.');

  const table = await AirtableTableModel.findOne({ organizationId: ORG_ID, baseId: base.baseId });
  if (!table) throw new Error(`No tables found for base "${base.name}". Please sync tables first.`);

  return { baseId: base.baseId, tableId: table.tableId, tableName: table.name };
}

async function airtablePost(token: string, url: string, body: any, attempt = 0): Promise<any> {
  try {
    await sleep(220);
    const res = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    return res.data;
  } catch (err: any) {
    if (err.response?.status === 429 && attempt < 4) {
      const wait = parseInt(err.response.headers['retry-after'] || '0', 10) * 1000 || Math.min(1000 * 2 ** attempt, 30000);
      console.log(`\nRate limited — waiting ${wait}ms...`);
      await sleep(wait);
      return airtablePost(token, url, body, attempt + 1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);
  console.log('Connected.\n');

  const token = await getAccessToken();
  console.log('Access token retrieved.\n');

  const { baseId, tableId, tableName } = await getFirstBaseAndTable();
  console.log(`Target: Base=${baseId}, Table="${tableName}" (${tableId})\n`);

  const url = `${config.airtable.baseUrl}/${baseId}/${tableId}`;
  const batches = Math.ceil(TOTAL_RECORDS / BATCH_SIZE);
  let created = 0;

  console.log(`Creating ${TOTAL_RECORDS} tickets in batches of ${BATCH_SIZE}...`);
  console.log('(No updates — change Status/Assignee manually in Airtable to generate revision history)\n');

  for (let i = 0; i < batches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, TOTAL_RECORDS);

    const records = Array.from({ length: end - start }, (_, j) => {
      const idx = start + j;
      return {
        fields: {
          Title: `[${String(idx + 1).padStart(3, '0')}] ${TITLES[idx % TITLES.length]}`,
          Status: randomItem(STATUSES),
          Priority: randomItem(PRIORITIES),
        },
      };
    });

    try {
      const res = await airtablePost(token, url, { records });
      created += res.records.length;
      process.stdout.write(`\rCreated: ${created}/${TOTAL_RECORDS}`);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      console.error(`\nBatch ${i + 1} failed: ${msg}`);
      if (err.response?.status === 422) {
        console.error('Hint: Make sure Status and Priority single-select options exist in Airtable.');
        break;
      }
    }
  }

  console.log(`\n\nDone: ${created} tickets created.\n`);
  console.log('Next steps:');
  console.log('  1. Open Airtable and manually change Status / Assignee on some tickets');
  console.log('  2. Click "Sync All" in the UI to pull all records into MongoDB');
  console.log('  3. Run the Scraper to fetch revision history for those changes');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\nSeeder failed:', err.message);
  process.exit(1);
});
