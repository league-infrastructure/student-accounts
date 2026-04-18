---
status: pending
priority: medium
source: inventory app (server/src/services/image.service.ts)
---

# Dual Image Storage (Local + S3)

Add image upload, processing, and storage that works locally in
development and replicates to S3-compatible storage in production.

## Schema

```prisma
model Image {
  id        Int      @id @default(autoincrement())
  url       String   // public URL (S3 or local)
  objectKey String?  // S3 key, e.g., "images/{checksum}.webp"
  fileName  String
  mimeType  String
  size      Int      // bytes
  width     Int?
  height    Int?
  checksum  String   // SHA256 of processed image
  createdAt DateTime @default(now())
}
```

## Dependencies

```
npm install sharp @aws-sdk/client-s3
```

## ImageService

Create `server/src/services/image.service.ts`:

### create(file)

1. Resize to max 1600px on the longest edge (Sharp)
2. Convert to WebP at quality 80
3. Compute SHA256 checksum of the processed image
4. Save to local `uploads/images/` directory
5. Upload to S3 (best-effort, same as backup service)
6. Create Image record in database

```typescript
async create(file: Express.Multer.File): Promise<ImageRecord> {
  const processed = await sharp(file.buffer)
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const checksum = crypto.createHash('sha256').update(processed).digest('hex');
  const objectKey = `images/${checksum}.webp`;

  // Save locally
  const localPath = path.join(UPLOAD_DIR, objectKey);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, processed);

  // Upload to S3 (best-effort)
  await this.uploadToS3(objectKey, processed).catch(err =>
    console.warn('S3 upload failed:', err.message)
  );

  const metadata = await sharp(processed).metadata();
  return this.prisma.image.create({
    data: {
      url: `/uploads/${objectKey}`,
      objectKey,
      fileName: file.originalname,
      mimeType: 'image/webp',
      size: processed.length,
      width: metadata.width,
      height: metadata.height,
      checksum,
    },
  });
}
```

### createFromUrl(url)

Fetch an image from a URL and process it the same way. Useful for
importing data that references external images.

### delete(id)

Remove the image record, local file, and S3 object.

## Routes

- `POST /api/images` — upload image (multipart form data)
- `GET /api/images/:id` — get image metadata
- `DELETE /api/images/:id` — delete image (admin only)

## Static Serving

In development, serve uploaded images via Express static middleware:

```typescript
app.use('/uploads', express.static(UPLOAD_DIR));
```

In production, either serve from the same path or redirect to S3 URLs.

## Environment Variables

```
UPLOAD_DIR=uploads                 # local upload directory
DO_SPACES_KEY=                     # optional
DO_SPACES_SECRET=
DO_SPACES_REGION=sfo3
DO_SPACES_BUCKET=your-app-uploads
```

## Reference Files

- Inventory: `server/src/services/image.service.ts`

## Verification

- Upload produces a WebP file in the local uploads directory
- Image is resized to max 1600px
- SHA256 checksum is computed and stored
- S3 upload works when configured, degrades gracefully when not
- Images are accessible via their URL
- Delete removes local file, S3 object, and database record
