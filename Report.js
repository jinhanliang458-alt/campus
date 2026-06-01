const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  detail: {
    type: String,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'resolved'],
    default: 'pending'
  },
  result: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// 防止重复举报（同一举报人对同一目标）
reportSchema.index({ reporterId: 1, targetId: 1 });

module.exports = mongoose.model('Report', reportSchema);
