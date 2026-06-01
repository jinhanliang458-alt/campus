const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Match = require('../models/Match');

// 存储在线用户映射: socketId -> userId
const onlineUsers = new Map();

const handleSocketConnection = (io) => {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 验证用户身份
    let currentUserId = null;

    socket.on('authenticate', (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUserId = decoded.userId;
        onlineUsers.set(socket.id, currentUserId);

        // 更新用户在线状态
        User.findByIdAndUpdate(currentUserId, {
          isOnline: true,
          lastActive: new Date()
        }).exec();

        console.log(`User ${currentUserId} authenticated on socket ${socket.id}`);

        socket.emit('authenticated', { success: true, userId: currentUserId });
      } catch (error) {
        console.error('Socket authentication error:', error.message);
        socket.emit('authenticated', { success: false, message: '认证失败' });
      }
    });

    // disconnect - 用户断开连接
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);

      if (currentUserId) {
        onlineUsers.delete(socket.id);

        // 检查该用户是否还有其他连接
        const isStillOnline = Array.from(onlineUsers.values())
          .some(id => id === currentUserId);

        if (!isStillOnline) {
          // 更新用户离线状态
          await User.findByIdAndUpdate(currentUserId, {
            isOnline: false,
            lastActive: new Date()
          }).exec();

          // 通知相关房间用户该用户已离线
          socket.broadcast.emit('user-offline', { userId: currentUserId });
        }
      }
    });

    // join-room - 加入匹配房间
    socket.on('join-room', async ({ matchId, token }) => {
      try {
        if (!token) {
          return socket.emit('error', { message: '未提供认证令牌' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        // 验证用户是否属于该匹配
        const match = await Match.findById(matchId);
        if (!match) {
          return socket.emit('error', { message: '匹配记录不存在' });
        }

        if (match.userId.toString() !== userId.toString() &&
            match.targetId.toString() !== userId.toString()) {
          return socket.emit('error', { message: '无权加入此房间' });
        }

        socket.join(`match-${matchId}`);
        console.log(`User ${userId} joined room match-${matchId}`);

        socket.emit('room-joined', { matchId, success: true });
      } catch (error) {
        console.error('Join room error:', error.message);
        socket.emit('error', { message: '加入房间失败' });
      }
    });

    // private-message - 发送私聊消息
    socket.on('private-message', async ({ matchId, content, token }) => {
      try {
        if (!token || !matchId || !content) {
          return socket.emit('error', { message: '参数不完整' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const senderId = decoded.userId;

        // 验证匹配记录
        const match = await Match.findById(matchId);
        if (!match) {
          return socket.emit('error', { message: '匹配记录不存在' });
        }

        if (match.userId.toString() !== senderId.toString() &&
            match.targetId.toString() !== senderId.toString()) {
          return socket.emit('error', { message: '无权在此匹配中发送消息' });
        }

        // 保存消息到数据库
        const message = new Message({
          matchId,
          senderId,
          content: content.trim().substring(0, 1000)
        });
        await message.save();

        // 填充发送者信息
        await message.populate('senderId', 'username avatar');

        // 广播消息给房间内所有用户（包括发送者）
        io.to(`match-${matchId}`).emit('new-message', message);

        // 更新匹配的 updatedAt 时间
        match.updatedAt = new Date();
        await match.save();
      } catch (error) {
        console.error('Private message error:', error.message);
        socket.emit('error', { message: '发送消息失败' });
      }
    });

    // typing - 正在输入提示
    socket.on('typing', async ({ matchId, token }) => {
      try {
        if (!token || !matchId) return;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        // 获取用户名
        const user = await User.findById(userId).select('username');
        if (!user) return;

        // 向房间内其他用户发送正在输入提示
        socket.to(`match-${matchId}`).emit('user-typing', {
          userId,
          username: user.username
        });
      } catch (error) {
        // 静默处理typing错误
      }
    });

    // stop-typing - 停止输入提示
    socket.on('stop-typing', ({ matchId, token }) => {
      try {
        if (!token || !matchId) return;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        socket.to(`match-${matchId}`).emit('user-stop-typing', {
          userId
        });
      } catch (error) {
        // 静默处理
      }
    });

    // leave-room - 离开匹配房间
    socket.on('leave-room', ({ matchId }) => {
      socket.leave(`match-${matchId}`);
      console.log(`Socket ${socket.id} left room match-${matchId}`);
    });
  });

  return { onlineUsers };
};

module.exports = handleSocketConnection;
