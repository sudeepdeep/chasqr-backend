import mongoose, { Document, Schema } from 'mongoose';

export interface ISiteFile extends Document {
  siteId: string;
  path: string;       // relative path e.g. 'index.html', 'css/style.css'
  content: Buffer;    // raw file bytes
  mimeType: string;
  size: number;
}

const SiteFileSchema = new Schema<ISiteFile>({
  siteId:   { type: String, required: true, index: true },
  path:     { type: String, required: true },
  content:  { type: Buffer, required: true },
  mimeType: { type: String, required: true },
  size:     { type: Number, required: true },
});

// Compound index so lookups by (siteId + path) are fast
SiteFileSchema.index({ siteId: 1, path: 1 }, { unique: true });

export default mongoose.model<ISiteFile>('SiteFile', SiteFileSchema);
