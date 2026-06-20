import { ChangelogModel, IChangelog } from './schemas/changelog.schema';
import { ScraperSessionModel, IScraperSession, ScraperStatus } from './schemas/scraper-session.schema';
import { ParsedActivity } from './changelog.parser';

export class ScraperRepository {
  async upsertSession(sessionId: string, data: Partial<IScraperSession>): Promise<IScraperSession> {
    return ScraperSessionModel.findOneAndUpdate(
      { sessionId },
      { ...data, sessionId },
      { upsert: true, new: true },
    );
  }

  async getSession(sessionId: string): Promise<IScraperSession | null> {
    return ScraperSessionModel.findOne({ sessionId });
  }

  async getLatestSession(organizationId: string): Promise<IScraperSession | null> {
    return ScraperSessionModel.findOne({ organizationId }).sort({ createdAt: -1 }).limit(1);
  }

  async updateSessionStatus(sessionId: string, status: ScraperStatus, extra?: Partial<IScraperSession>): Promise<void> {
    await ScraperSessionModel.updateOne({ sessionId }, { $set: { status, ...extra } });
  }

  async incrementProgress(sessionId: string, processed: number, failed: number): Promise<void> {
    await ScraperSessionModel.updateOne(
      { sessionId },
      { $inc: { 'progress.processed': processed, 'progress.failed': failed } },
    );
  }

  async bulkUpsertChangelogs(organizationId: string, activities: ParsedActivity[]): Promise<number> {
    if (!activities.length) return 0;

    const ops = activities.map((a) => ({
      updateOne: {
        filter: { organizationId, issueId: a.issueId, uuid: a.uuid },
        update: {
          $set: {
            organizationId,
            uuid: a.uuid,
            issueId: a.issueId,
            baseId: a.baseId,
            tableId: a.tableId,
            columnType: a.columnType,
            oldValue: a.oldValue,
            newValue: a.newValue,
            createdDate: a.createdDate,
            authoredBy: a.authoredBy,
            rawActivity: a.rawActivity,
          },
        },
        upsert: true,
      },
    }));

    const result = await ChangelogModel.bulkWrite(ops as any);
    return result.upsertedCount + result.modifiedCount;
  }

  async getChangelogs(
    organizationId: string,
    filter: Record<string, any> = {},
    page = 1,
    pageSize = 100,
  ): Promise<{ changelogs: IChangelog[]; total: number }> {
    const query = { organizationId, ...filter };
    const [changelogs, total] = await Promise.all([
      ChangelogModel.find(query)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .sort({ createdDate: -1 }),
      ChangelogModel.countDocuments(query),
    ]);
    return { changelogs, total };
  }

  async getChangelogStats(organizationId: string): Promise<{
    total: number;
    byType: { status: number; assignee: number };
  }> {
    const [total, groups] = await Promise.all([
      ChangelogModel.countDocuments({ organizationId }),
      ChangelogModel.aggregate([
        { $match: { organizationId } },
        { $group: { _id: '$columnType', count: { $sum: 1 } } },
      ]),
    ]);

    const byType: Record<string, number> = {};
    for (const g of groups) byType[g._id] = g.count;

    return {
      total,
      byType: { status: byType['status'] ?? 0, assignee: byType['assignee'] ?? 0 },
    };
  }
}
