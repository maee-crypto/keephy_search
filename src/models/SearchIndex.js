/**
 * Search Index Model
 * Represents searchable content with full-text search capabilities
 */

import mongoose from 'mongoose';

const searchIndexSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
    index: true
  },
  franchiseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Franchise',
    default: null,
    index: true
  },
  contentType: {
    type: String,
    required: true,
    enum: ['submission', 'form', 'staff', 'franchise', 'business', 'discount', 'notification', 'report'],
    index: true
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
    text: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 5000,
    text: true
  },
  tags: [{
    type: String,
    maxlength: 50,
    text: true
  }],
  categories: [{
    type: String,
    maxlength: 50,
    text: true
  }],
  metadata: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    sentiment: {
      type: String,
      enum: ['positive', 'negative', 'neutral']
    },
    language: {
      type: String,
      maxlength: 10,
      default: 'en'
    },
    source: {
      type: String,
      maxlength: 50
    },
    author: {
      type: String,
      maxlength: 100
    },
    custom: mongoose.Schema.Types.Mixed
  },
  searchableFields: {
    type: Map,
    of: String
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  indexedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Text indexes for full-text search
searchIndexSchema.index({
  title: 'text',
  content: 'text',
  tags: 'text',
  categories: 'text'
}, {
  weights: {
    title: 10,
    content: 5,
    tags: 8,
    categories: 6
  },
  name: 'text_search_index'
});

// Compound indexes
searchIndexSchema.index({ businessId: 1, contentType: 1, isActive: 1 });
searchIndexSchema.index({ franchiseId: 1, contentType: 1, isActive: 1 });
searchIndexSchema.index({ contentId: 1, contentType: 1 });
searchIndexSchema.index({ 'metadata.rating': 1, indexedAt: -1 });
searchIndexSchema.index({ 'metadata.sentiment': 1, indexedAt: -1 });
searchIndexSchema.index({ 'metadata.language': 1, isActive: 1 });
searchIndexSchema.index({ indexedAt: -1 });

// Pre-save middleware
searchIndexSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  this.indexedAt = new Date();
  next();
});

// Methods
searchIndexSchema.methods.updateContent = function(newContent) {
  this.content = newContent;
  this.indexedAt = new Date();
  return this.save();
};

searchIndexSchema.methods.addTag = function(tag) {
  if (!this.tags.includes(tag)) {
    this.tags.push(tag);
  }
  return this.save();
};

searchIndexSchema.methods.removeTag = function(tag) {
  this.tags = this.tags.filter(t => t !== tag);
  return this.save();
};

// Static methods
searchIndexSchema.statics.search = function(query, options = {}) {
  const {
    businessId,
    franchiseId,
    contentType,
    tags,
    categories,
    rating,
    sentiment,
    language,
    limit = 50,
    offset = 0,
    sortBy = { score: { $meta: 'textScore' }, indexedAt: -1 }
  } = options;

  let searchQuery = {};

  // Text search
  if (query) {
    searchQuery.$text = { $search: query };
  }

  // Filters
  if (businessId) searchQuery.businessId = businessId;
  if (franchiseId) searchQuery.franchiseId = franchiseId;
  if (contentType) searchQuery.contentType = contentType;
  if (tags && tags.length > 0) searchQuery.tags = { $in: tags };
  if (categories && categories.length > 0) searchQuery.categories = { $in: categories };
  if (rating) searchQuery['metadata.rating'] = rating;
  if (sentiment) searchQuery['metadata.sentiment'] = sentiment;
  if (language) searchQuery['metadata.language'] = language;
  
  searchQuery.isActive = true;

  return this.find(searchQuery)
    .sort(sortBy)
    .limit(limit)
    .skip(offset)
    .populate('contentId', 'name description')
    .populate('franchiseId', 'name')
    .lean();
};

searchIndexSchema.statics.searchByContentType = function(contentType, query, options = {}) {
  return this.search(query, { ...options, contentType });
};

searchIndexSchema.statics.getPopularTags = function(businessId, limit = 20) {
  return this.aggregate([
    { $match: { businessId, isActive: true } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
};

searchIndexSchema.statics.getContentStats = function(businessId) {
  return this.aggregate([
    { $match: { businessId, isActive: true } },
    {
      $group: {
        _id: '$contentType',
        count: { $sum: 1 },
        avgRating: { $avg: '$metadata.rating' },
        sentimentBreakdown: {
          $push: '$metadata.sentiment'
        }
      }
    },
    {
      $project: {
        contentType: '$_id',
        count: 1,
        avgRating: { $round: ['$avgRating', 2] },
        sentimentBreakdown: 1
      }
    }
  ]);
};

searchIndexSchema.statics.getRecentContent = function(businessId, limit = 20) {
  return this.find({
    businessId,
    isActive: true
  })
  .sort({ indexedAt: -1 })
  .limit(limit)
  .populate('contentId', 'name description')
  .populate('franchiseId', 'name')
  .lean();
};

searchIndexSchema.statics.getContentByRating = function(businessId, minRating = 4, limit = 20) {
  return this.find({
    businessId,
    'metadata.rating': { $gte: minRating },
    isActive: true
  })
  .sort({ 'metadata.rating': -1, indexedAt: -1 })
  .limit(limit)
  .populate('contentId', 'name description')
  .populate('franchiseId', 'name')
  .lean();
};

export default mongoose.model('SearchIndex', searchIndexSchema);
