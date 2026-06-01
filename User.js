const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 20
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  gender: {
    type: String,
    enum: ['male', 'female'],
    required: true
  },
  avatar: {
    type: String,
    default: ''
  },
  height: {
    type: Number,
    min: 100,
    max: 250
  },
  weight: {
    type: Number,
    min: 30,
    max: 200
  },
  hobbies: [{
    type: String
  }],
  bio: {
    type: String,
    maxlength: 200
  },
  // 学生认证
  studentCardPhoto: {
    type: String,
    default: ''
  },
  facePhoto: {
    type: String,
    default: ''
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifyTime: {
    type: Date
  },
  // 信用系统
  flowers: {
    type: Number,
    default: 0
  },
  eggs: {
    type: Number,
    default: 0
  },
  credit: {
    type: Number,
    default: 100
  },
  isVip: {
    type: Boolean,
    default: false
  },
  // 账号状态
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockReason: {
    type: String
  },
  // 在线状态
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  // 设置
  settings: {
    notifyMessage: { type: Boolean, default: true },
    notifyMatch: { type: Boolean, default: true },
    notifySystem: { type: Boolean, default: false },
    ageMin: { type: Number, default: 18 },
    ageMax: { type: Number, default: 25 },
    distance: { type: Number, default: 10 },
    verifiedOnly: { type: Boolean, default: false },
    showOnline: { type: Boolean, default: true },
    showDistance: { type: Boolean, default: false }
  },
  // 位置信息（用于距离计算）
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    }
  }
}, {
  timestamps: true
});

// 密码加密
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// 验证密码
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 隐藏敏感信息
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.studentCardPhoto;
  delete user.facePhoto;
  return user;
};

// 地理索引
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
