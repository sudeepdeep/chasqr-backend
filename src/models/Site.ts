import mongoose, { Document, Schema } from 'mongoose';
import { SiteStatus, ContentType } from '../types';

export interface IContentItem {
  key: string;
  label: string;
  value: string;
  type: ContentType;
}

export interface IPage {
  filename: string;
  title: string;
  contentMap: IContentItem[];
  metaDescription?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
}

export interface ISite extends Document {
  userId: mongoose.Types.ObjectId;
  siteId: string;
  slug: string;          // public URL identifier — user-chosen or defaults to siteId
  name: string;
  pages: IPage[];
  status: SiteStatus;
  plan: 'free' | 'paid';
  visits: number;        // total count (kept for backwards compatibility)
  visitHistory: Date[];  // array of visit timestamps
  created_at: Date;
  updated_at: Date;
}

const ContentItemSchema = new Schema<IContentItem>(
  {
    key:   { type: String, required: true },
    label: { type: String, required: true },
    value: { type: String, default: '' },
    type:  { type: String, enum: ['text', 'image', 'link'], default: 'text' },
  },
  { _id: false }
);

const PageSchema = new Schema<IPage>(
  {
    filename:        { type: String, required: true },
    title:           { type: String, default: '' },
    contentMap:      { type: [ContentItemSchema], default: [] },
    metaDescription: { type: String, default: '' },
    ogImage:         { type: String, default: '' },
    ogTitle:         { type: String, default: '' },
    ogDescription:   { type: String, default: '' },
  },
  { _id: false }
);

const SiteSchema = new Schema<ISite>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    siteId:        { type: String, required: true, unique: true },
    slug:          { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:          { type: String, required: true, trim: true },
    pages:         { type: [PageSchema], default: [] },
    status:        { type: String, enum: ['active', 'inactive'], default: 'active' },
    plan:          { type: String, enum: ['free', 'paid'], default: 'free' },
    visits:        { type: Number, default: 0 },
    visitHistory:  { type: [Date], default: [] },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

SiteSchema.index({ userId: 1 });
SiteSchema.index({ status: 1 });

export default mongoose.model<ISite>('Site', SiteSchema);
