#!/usr/bin/env node

/**
 * Keephy Search Service
 * Manages full-text search, indexing, and content discovery
 */

import express from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

// Import models
import SearchIndex from './models/SearchIndex.js';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const PORT = process.env.PORT || 3014;

// Middleware
app.use(helmet());
app.use(cors());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/keephy_enhanced';

mongoose.connect(MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'keephy_search',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ready', service: 'keephy_search' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// =============================================================================
// SEARCH ROUTES
// =============================================================================

// Global search
app.get('/api/search', async (req, res) => {
  try {
    const {
      q,
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
      sortBy = 'relevance'
    } = req.query;

    if (!q && !businessId) {
      return res.status(400).json({
        success: false,
        error: 'Search query or businessId is required'
      });
    }

    const options = {
      businessId,
      franchiseId,
      contentType,
      tags: tags ? tags.split(',') : undefined,
      categories: categories ? categories.split(',') : undefined,
      rating: rating ? parseInt(rating) : undefined,
      sentiment,
      language,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    // Handle different sort options
    let sortOptions = { indexedAt: -1 };
    if (sortBy === 'relevance' && q) {
      sortOptions = { score: { $meta: 'textScore' }, indexedAt: -1 };
    } else if (sortBy === 'rating') {
      sortOptions = { 'metadata.rating': -1, indexedAt: -1 };
    } else if (sortBy === 'date') {
      sortOptions = { indexedAt: -1 };
    }

    const results = await SearchIndex.search(q, { ...options, sortBy: sortOptions });

    res.json({
      success: true,
      data: results,
      count: results.length,
      query: q,
      filters: options
    });
  } catch (error) {
    logger.error('Error performing search:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform search'
    });
  }
});

// Search by content type
app.get('/api/search/:contentType', async (req, res) => {
  try {
    const { contentType } = req.params;
    const {
      q,
      businessId,
      franchiseId,
      tags,
      categories,
      rating,
      sentiment,
      language,
      limit = 50,
      offset = 0
    } = req.query;

    const options = {
      businessId,
      franchiseId,
      tags: tags ? tags.split(',') : undefined,
      categories: categories ? categories.split(',') : undefined,
      rating: rating ? parseInt(rating) : undefined,
      sentiment,
      language,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const results = await SearchIndex.searchByContentType(contentType, q, options);

    res.json({
      success: true,
      data: results,
      count: results.length,
      contentType,
      query: q,
      filters: options
    });
  } catch (error) {
    logger.error('Error searching by content type:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search by content type'
    });
  }
});

// Advanced search with filters
app.post('/api/search/advanced', async (req, res) => {
  try {
    const {
      query,
      filters = {},
      pagination = { limit: 50, offset: 0 },
      sort = { field: 'indexedAt', order: 'desc' }
    } = req.body;

    const searchOptions = {
      ...filters,
      limit: pagination.limit,
      offset: pagination.offset
    };

    let sortOptions = { indexedAt: -1 };
    if (sort.field === 'relevance' && query) {
      sortOptions = { score: { $meta: 'textScore' }, indexedAt: -1 };
    } else if (sort.field === 'rating') {
      sortOptions = { 'metadata.rating': sort.order === 'asc' ? 1 : -1, indexedAt: -1 };
    } else if (sort.field === 'date') {
      sortOptions = { indexedAt: sort.order === 'asc' ? 1 : -1 };
    }

    const results = await SearchIndex.search(query, { ...searchOptions, sortBy: sortOptions });

    res.json({
      success: true,
      data: results,
      count: results.length,
      pagination: {
        limit: pagination.limit,
        offset: pagination.offset,
        total: results.length
      },
      sort,
      filters
    });
  } catch (error) {
    logger.error('Error performing advanced search:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform advanced search'
    });
  }
});

// =============================================================================
// INDEXING ROUTES
// =============================================================================

// Index content
app.post('/api/search/index', async (req, res) => {
  try {
    const {
      businessId,
      franchiseId,
      contentType,
      contentId,
      title,
      content,
      tags = [],
      categories = [],
      metadata = {}
    } = req.body;

    const searchIndex = new SearchIndex({
      businessId,
      franchiseId,
      contentType,
      contentId,
      title,
      content,
      tags,
      categories,
      metadata: {
        ...metadata,
        indexedAt: new Date()
      }
    });

    await searchIndex.save();

    res.status(201).json({
      success: true,
      data: searchIndex
    });
  } catch (error) {
    logger.error('Error indexing content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to index content'
    });
  }
});

// Update indexed content
app.put('/api/search/index/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const searchIndex = await SearchIndex.findByIdAndUpdate(
      id,
      { ...updateData, indexedAt: new Date() },
      { new: true }
    );

    if (!searchIndex) {
      return res.status(404).json({
        success: false,
        error: 'Search index not found'
      });
    }

    res.json({
      success: true,
      data: searchIndex
    });
  } catch (error) {
    logger.error('Error updating search index:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update search index'
    });
  }
});

// Delete indexed content
app.delete('/api/search/index/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const searchIndex = await SearchIndex.findByIdAndDelete(id);

    if (!searchIndex) {
      return res.status(404).json({
        success: false,
        error: 'Search index not found'
      });
    }

    res.json({
      success: true,
      message: 'Search index deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting search index:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete search index'
    });
  }
});

// Bulk index content
app.post('/api/search/index/bulk', async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required'
      });
    }

    const searchIndexes = items.map(item => ({
      ...item,
      indexedAt: new Date()
    }));

    const result = await SearchIndex.insertMany(searchIndexes);

    res.status(201).json({
      success: true,
      data: result,
      count: result.length
    });
  } catch (error) {
    logger.error('Error bulk indexing content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk index content'
    });
  }
});

// =============================================================================
// ANALYTICS ROUTES
// =============================================================================

// Get popular tags
app.get('/api/search/tags/popular', async (req, res) => {
  try {
    const { businessId, limit = 20 } = req.query;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'BusinessId is required'
      });
    }

    const popularTags = await SearchIndex.getPopularTags(businessId, parseInt(limit));

    res.json({
      success: true,
      data: popularTags,
      count: popularTags.length
    });
  } catch (error) {
    logger.error('Error fetching popular tags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch popular tags'
    });
  }
});

// Get content statistics
app.get('/api/search/stats', async (req, res) => {
  try {
    const { businessId } = req.query;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'BusinessId is required'
      });
    }

    const stats = await SearchIndex.getContentStats(businessId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching content statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch content statistics'
    });
  }
});

// Get recent content
app.get('/api/search/recent', async (req, res) => {
  try {
    const { businessId, limit = 20 } = req.query;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'BusinessId is required'
      });
    }

    const recentContent = await SearchIndex.getRecentContent(businessId, parseInt(limit));

    res.json({
      success: true,
      data: recentContent,
      count: recentContent.length
    });
  } catch (error) {
    logger.error('Error fetching recent content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent content'
    });
  }
});

// Get high-rated content
app.get('/api/search/high-rated', async (req, res) => {
  try {
    const { businessId, minRating = 4, limit = 20 } = req.query;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'BusinessId is required'
      });
    }

    const highRatedContent = await SearchIndex.getContentByRating(
      businessId,
      parseInt(minRating),
      parseInt(limit)
    );

    res.json({
      success: true,
      data: highRatedContent,
      count: highRatedContent.length
    });
  } catch (error) {
    logger.error('Error fetching high-rated content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch high-rated content'
    });
  }
});

// =============================================================================
// SEARCH SUGGESTIONS
// =============================================================================

// Get search suggestions
app.get('/api/search/suggestions', async (req, res) => {
  try {
    const { q, businessId, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
        count: 0
      });
    }

    // Get suggestions from titles and tags
    const suggestions = await SearchIndex.aggregate([
      {
        $match: {
          businessId: new mongoose.Types.ObjectId(businessId),
          isActive: true,
          $or: [
            { title: { $regex: q, $options: 'i' } },
            { tags: { $regex: q, $options: 'i' } }
          ]
        }
      },
      {
        $project: {
          title: 1,
          tags: 1,
          contentType: 1
        }
      },
      {
        $limit: parseInt(limit)
      }
    ]);

    res.json({
      success: true,
      data: suggestions,
      count: suggestions.length
    });
  } catch (error) {
    logger.error('Error fetching search suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch search suggestions'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Keephy Search Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});