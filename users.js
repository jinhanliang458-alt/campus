const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Match = require('../models/Match');
const Report = require('../models/Report');

const router = express.Router();

// 配置multer文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB限制
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片格式（jpeg, jpg, png, gif, webp）'));
    }
  }
});

// GET /recommendations - 获取推荐用户列表
router.get('/recommendations', auth, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const currentUser = req.user;

    // 查找已匹配的用户ID
    const matches = await Match.find({
      $or: [{ userId: currentUserId }, { targetId: currentUserId }],
      isMatch: true
    });
    const matchedUserIds = matches.map(m =>
      m.userId.toString() === currentUserId.toString() ? m.targetId : m.userId
    );

    // 构建查询条件
    const query = {
      _id: { $ne: currentUserId }, // 排除自己
      _id: { $nin: matchedUserIds }, // 排除已匹配的
      gender: { $ne: currentUser.gender }, // 排除同性别
      isBlocked: false // 排除被封禁的
    };

    // 按信用分排序
    let users = await User.find(query)
      .select('-password -studentCardPhoto -facePhoto')
      .sort({ credit: -1, flowers: -1 });

    // 臭鸡蛋>=5的减少推荐（排在后面）
    users.sort((a, b) => {
      const aPenalty = a.eggs >= 5 ? 1 : 0;
      const bPenalty = b.eggs >= 5 ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return b.credit - a.credit;
    });

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('获取推荐用户错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// PUT /profile - 更新个人资料
router.put('/profile', auth, async (req, res) => {
  try {
    const { username, height, weight, bio, hobbies, avatar } = req.body;
    const updates = {};

    if (username) {
      // 检查用户名是否已被占用（排除自己）
      const existing = await User.findOne({ username, _id: { $ne: req.user._id } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: '用户名已存在'
        });
      }
      updates.username = username;
    }
    if (height !== undefined) updates.height = height;
    if (weight !== undefined) updates.weight = weight;
    if (bio !== undefined) updates.bio = bio;
    if (hobbies !== undefined) updates.hobbies = hobbies;
    if (avatar !== undefined) updates.avatar = avatar;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: user.toJSON()
    });
  } catch (error) {
    console.error('更新资料错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /avatar - 上传头像
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的头像'
      });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;

    // 更新用户头像
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: avatarUrl },
      { new: true }
    );

    res.json({
      success: true,
      data: {
        avatar: avatarUrl,
        user: user.toJSON()
      }
    });
  } catch (error) {
    console.error('上传头像错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /verify - 提交学生认证
router.post('/verify', auth, async (req, res) => {
  try {
    const { studentCardPhoto, facePhoto } = req.body;

    if (!studentCardPhoto || !facePhoto) {
      return res.status(400).json({
        success: false,
        message: '请上传学生证照片和面部照片'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        studentCardPhoto,
        facePhoto,
        isVerified: false // 提交后等待审核
      },
      { new: true }
    );

    res.json({
      success: true,
      message: '认证材料已提交，请等待审核',
      data: user.toJSON()
    });
  } catch (error) {
    console.error('提交认证错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /flower/:targetId - 送鲜花
router.post('/flower/:targetId', auth, async (req, res) => {
  try {
    const { targetId } = req.params;

    if (targetId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: '不能给自己送鲜花'
      });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 更新对方鲜花数和信用分
    targetUser.flowers += 1;
    targetUser.credit += 5;
    await targetUser.save();

    res.json({
      success: true,
      message: `已向 ${targetUser.username} 送出鲜花`,
      data: {
        targetFlowers: targetUser.flowers,
        targetCredit: targetUser.credit
      }
    });
  } catch (error) {
    console.error('送鲜花错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /egg/:targetId - 扔臭鸡蛋
router.post('/egg/:targetId', auth, async (req, res) => {
  try {
    const { targetId } = req.params;

    if (targetId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: '不能给自己扔臭鸡蛋'
      });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 更新对方臭鸡蛋数和信用分
    targetUser.eggs += 1;
    targetUser.credit -= 10;

    // 信用分不低于0
    if (targetUser.credit < 0) {
      targetUser.credit = 0;
    }

    await targetUser.save();

    res.json({
      success: true,
      message: `已向 ${targetUser.username} 扔出臭鸡蛋`,
      data: {
        targetEggs: targetUser.eggs,
        targetCredit: targetUser.credit
      }
    });
  } catch (error) {
    console.error('扔臭鸡蛋错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /report/:targetId - 提交举报
router.post('/report/:targetId', auth, async (req, res) => {
  try {
    const { targetId } = req.params;
    const { reason, detail } = req.body;

    if (targetId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: '不能举报自己'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: '请填写举报原因'
      });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 创建举报记录
    const report = new Report({
      reporterId: req.user._id,
      targetId,
      reason,
      detail: detail || ''
    });
    await report.save();

    res.json({
      success: true,
      message: '举报已提交，我们会尽快处理'
    });
  } catch (error) {
    console.error('提交举报错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
