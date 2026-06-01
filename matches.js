const express = require('express');
const auth = require('../middleware/auth');
const Match = require('../models/Match');
const Message = require('../models/Message');
const User = require('../models/User');

const router = express.Router();

// POST /swipe - 滑动操作
router.post('/swipe', auth, async (req, res) => {
  try {
    const { targetId, isLike } = req.body;
    const userId = req.user._id;

    if (!targetId || isLike === undefined) {
      return res.status(400).json({
        success: false,
        message: '请提供目标用户ID和滑动操作'
      });
    }

    if (targetId === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: '不能对自己进行滑动操作'
      });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 查找是否已有匹配记录（双向查找）
    let match = await Match.findOne({
      $or: [
        { userId, targetId },
        { userId: targetId, targetId: userId }
      ]
    });

    if (match) {
      // 已有记录，更新当前用户的喜欢状态
      if (match.userId.toString() === userId.toString()) {
        match.userLiked = isLike;
      } else {
        match.targetLiked = isLike;
      }

      // 检查是否双向喜欢
      if (match.userLiked && match.targetLiked && !match.isMatch) {
        match.isMatch = true;
        await match.save();

        return res.json({
          success: true,
          message: '恭喜，匹配成功！',
          data: match
        });
      }

      await match.save();
      return res.json({
        success: true,
        message: isLike ? '已喜欢' : '已跳过',
        data: match
      });
    }

    // 创建新的匹配记录
    match = new Match({
      userId,
      targetId,
      userLiked: isLike,
      targetLiked: false,
      isMatch: false
    });
    await match.save();

    res.status(201).json({
      success: true,
      message: isLike ? '已喜欢' : '已跳过',
      data: match
    });
  } catch (error) {
    console.error('滑动操作错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// GET / - 获取我的匹配列表（包含最后一条消息预览）
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // 查找所有已匹配的记录
    const matches = await Match.find({
      $or: [{ userId }, { targetId: userId }],
      isMatch: true
    }).sort({ updatedAt: -1 });

    // 获取每个匹配的最后一条消息和对方用户信息
    const matchList = await Promise.all(matches.map(async (match) => {
      const otherUserId = match.userId.toString() === userId.toString()
        ? match.targetId
        : match.userId;

      const otherUser = await User.findById(otherUserId)
        .select('-password -studentCardPhoto -facePhoto');

      // 获取最后一条消息
      const lastMessage = await Message.findOne({ matchId: match._id })
        .sort({ createdAt: -1 })
        .select('content createdAt senderId');

      // 如果照片未解锁，隐藏头像
      const userResponse = otherUser.toJSON();
      if (!match.photoRevealed) {
        userResponse.avatar = '';
      }

      return {
        match: match,
        otherUser: userResponse,
        lastMessage: lastMessage || null
      };
    }));

    res.json({
      success: true,
      data: matchList
    });
  } catch (error) {
    console.error('获取匹配列表错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// GET /:matchId/messages - 获取匹配的聊天记录
router.get('/:matchId/messages', auth, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user._id;

    // 验证匹配记录存在且属于当前用户
    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: '匹配记录不存在'
      });
    }

    if (match.userId.toString() !== userId.toString() &&
        match.targetId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: '无权访问此聊天'
      });
    }

    // 获取聊天记录
    const messages = await Message.find({ matchId })
      .sort({ createdAt: 1 })
      .populate('senderId', 'username avatar');

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('获取聊天记录错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /:matchId/reveal - 请求查看照片
router.post('/:matchId/reveal', auth, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user._id;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: '匹配记录不存在'
      });
    }

    if (match.userId.toString() !== userId.toString() &&
        match.targetId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: '无权操作此匹配'
      });
    }

    // 更新当前用户的揭示请求
    if (match.userId.toString() === userId.toString()) {
      match.userWantsReveal = true;
    } else {
      match.targetWantsReveal = true;
    }

    // 检查双方是否都同意揭示
    if (match.userWantsReveal && match.targetWantsReveal) {
      match.photoRevealed = true;
      await match.save();

      return res.json({
        success: true,
        message: '双方已同意，照片已解锁！',
        data: match
      });
    }

    await match.save();

    res.json({
      success: true,
      message: '已发送照片查看请求，等待对方同意',
      data: match
    });
  } catch (error) {
    console.error('照片揭示错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /:matchId/flower - 在聊天中送鲜花
router.post('/:matchId/flower', auth, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user._id;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: '匹配记录不存在'
      });
    }

    if (match.userId.toString() !== userId.toString() &&
        match.targetId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: '无权操作此匹配'
      });
    }

    // 确定对方用户
    const targetUserId = match.userId.toString() === userId.toString()
      ? match.targetId
      : match.userId;

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 更新鲜花和信用分
    targetUser.flowers += 1;
    targetUser.credit += 5;
    await targetUser.save();

    // 创建系统消息
    const systemMessage = new Message({
      matchId: match._id,
      senderId: userId,
      content: `[鲜花] 向 ${targetUser.username} 送出了一朵鲜花`
    });
    await systemMessage.save();

    res.json({
      success: true,
      message: `已向 ${targetUser.username} 送出鲜花`,
      data: {
        targetFlowers: targetUser.flowers,
        targetCredit: targetUser.credit,
        systemMessage
      }
    });
  } catch (error) {
    console.error('聊天送鲜花错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// POST /:matchId/egg - 在聊天中扔臭鸡蛋
router.post('/:matchId/egg', auth, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user._id;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: '匹配记录不存在'
      });
    }

    if (match.userId.toString() !== userId.toString() &&
        match.targetId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: '无权操作此匹配'
      });
    }

    // 确定对方用户
    const targetUserId = match.userId.toString() === userId.toString()
      ? match.targetId
      : match.userId;

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: '目标用户不存在'
      });
    }

    // 更新臭鸡蛋和信用分
    targetUser.eggs += 1;
    targetUser.credit -= 10;
    if (targetUser.credit < 0) {
      targetUser.credit = 0;
    }
    await targetUser.save();

    // 创建系统消息
    const systemMessage = new Message({
      matchId: match._id,
      senderId: userId,
      content: `[臭鸡蛋] 向 ${targetUser.username} 扔了一个臭鸡蛋`
    });
    await systemMessage.save();

    res.json({
      success: true,
      message: `已向 ${targetUser.username} 扔出臭鸡蛋`,
      data: {
        targetEggs: targetUser.eggs,
        targetCredit: targetUser.credit,
        systemMessage
      }
    });
  } catch (error) {
    console.error('聊天扔臭鸡蛋错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
