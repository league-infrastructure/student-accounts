import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

/** Resolve the SQLite database file path from DATABASE_URL. */
function sqliteDbPath(): string {
  const url = process.env.DATABASE_URL || '';
  // file:./data/dev.db → ./data/dev.db
  return url.replace(/^file:/, '');
}

/** Build an S3 client for DigitalOcean Spaces, or null if not configured. */
function buildS3Client(): S3Client | null {
  const endpoint = process.env.DO_SPACES_ENDPOINT;
  const key = process.env.DO_SPACES_KEY;
  const secret = process.env.DO_SPACES_SECRET;
  const region = process.env.DO_SPACES_REGION || 'sfo3';

  if (!endpoint || !key || !secret) return null;

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });
}

export class BackupService {
  private prisma: any;
  private backupDir: string;
  private s3: S3Client | null;
  private bucket: string;
  private s3Prefix: string;

  constructor(prisma: any) {
    this.prisma = prisma;
    this.backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'data/backups');
    this.s3 = buildS3Client();
    this.bucket = process.env.DO_SPACES_BUCKET || '';
    this.s3Prefix = `${process.env.APP_SLUG || 'app'}/backups/`;
  }

  private async ensureDir() {
    await fs.mkdir(this.backupDir, { recursive: true });
  }

  private validateFilename(filename: string) {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid filename');
    }
  }

  private get s3Configured(): boolean {
    return !!(this.s3 && this.bucket);
  }

  private async uploadToS3(filename: string, body: string | Buffer): Promise<void> {
    if (!this.s3Configured) return;
    await this.s3!.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.s3Prefix}${filename}`,
      Body: body,
      ContentType: 'application/x-sqlite3',
    }));
  }

  private async deleteFromS3(filename: string): Promise<void> {
    if (!this.s3Configured) return;
    await this.s3!.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: `${this.s3Prefix}${filename}`,
    }));
  }

  async createBackup(): Promise<{ filename: string; timestamp: string; size: number; s3: boolean }> {
    await this.ensureDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.db`;
    const filepath = path.join(this.backupDir, filename);
    const dbPath = sqliteDbPath();

    await fs.copyFile(dbPath, filepath);
    const stats = await fs.stat(filepath);

    let s3Ok = false;
    if (this.s3Configured) {
      try {
        const body = await fs.readFile(filepath);
        await this.uploadToS3(filename, body);
        s3Ok = true;
      } catch (err) {
        console.error('S3 upload failed:', err);
      }
    }

    return { filename, timestamp: new Date().toISOString(), size: stats.size, s3: s3Ok };
  }

  async listBackups(): Promise<Array<{ filename: string; size: number; created: string; s3: boolean }>> {
    await this.ensureDir();

    const localFiles = await fs.readdir(this.backupDir);
    const backupMap = new Map<string, { filename: string; size: number; created: string; s3: boolean }>();
    for (const file of localFiles.filter(f => f.endsWith('.db'))) {
      const stats = await fs.stat(path.join(this.backupDir, file));
      backupMap.set(file, { filename: file, size: stats.size, created: stats.birthtime.toISOString(), s3: false });
    }

    // Merge with S3 listing
    if (this.s3Configured) {
      try {
        const resp = await this.s3!.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.s3Prefix,
        }));
        for (const obj of resp.Contents || []) {
          const key = obj.Key || '';
          const fname = key.replace(this.s3Prefix, '');
          if (!fname || !fname.endsWith('.db')) continue;
          if (backupMap.has(fname)) {
            backupMap.get(fname)!.s3 = true;
          } else {
            backupMap.set(fname, {
              filename: fname,
              size: obj.Size || 0,
              created: obj.LastModified?.toISOString() || '',
              s3: true,
            });
          }
        }
      } catch (err) {
        console.error('S3 list failed:', err);
      }
    }

    return Array.from(backupMap.values()).sort((a, b) => b.created.localeCompare(a.created));
  }

  async restoreBackup(filename: string): Promise<{ success: boolean }> {
    this.validateFilename(filename);
    const filepath = path.join(this.backupDir, filename);
    const dbPath = sqliteDbPath();
    await fs.copyFile(filepath, dbPath);
    return { success: true };
  }

  async deleteBackup(filename: string): Promise<void> {
    this.validateFilename(filename);

    const filepath = path.join(this.backupDir, filename);
    try {
      await fs.unlink(filepath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (this.s3Configured) {
      try {
        await this.deleteFromS3(filename);
      } catch (err) {
        console.error('S3 delete failed:', err);
      }
    }
  }

  async exportJson(): Promise<any> {
    const [users, configs, scheduledJobs] = await Promise.all([
      this.prisma.user.findMany(),
      this.prisma.config.findMany(),
      this.prisma.scheduledJob.findMany(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      tables: {
        User: { count: users.length, records: users },
        Config: { count: configs.length, records: configs },
        ScheduledJob: { count: scheduledJobs.length, records: scheduledJobs },
      },
    };
  }
}
