const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userLiked: {
    type: Boolean,
    default: false
  },
  targetLiked: {
    type: Boolean,
    default: false
  },
  isMatch: {
    type: Boolean,
    default: false
  },
  photoRevealed: {
    type: Boolean,
    default: false
  },
  userWantsReveal: {
    type: Boolean,
    default: false
  },
  targetWantsReveal: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// 确保同一对用户之间只有一个匹配记录
matchSchema.index({ userId: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Match', matchSchema);
