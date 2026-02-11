import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import connectDB from './lib/db.js';
import Message from './models/Message.js';
import Chat from './models/Chat.js';

const PORT = process.env.PORT || 3001;

/* =========================
   CREATE SERVER
========================= */
const server = http.createServer();

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

/* =========================
   SOCKET CONNECTION
========================= */
io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);

    /* 🔐 AUTH SOCKET */
    socket.on('join', async (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            socket.userId = decoded.id.toString();
            socket.join(socket.userId);

            console.log('✅ Socket authenticated:', socket.userId);

            await connectDB();

            // 🔥 Mark pending messages as delivered
            await Message.updateMany(
                {
                    sender: { $ne: socket.userId },
                    deliveredTo: { $ne: socket.userId },
                },
                { $addToSet: { deliveredTo: socket.userId } }
            );
        } catch (err) {
            console.log('❌ Socket auth failed');
            socket.disconnect();
        }
    });

    /* 📩 JOIN CHAT ROOM */
    socket.on('join-chat', async (chatId) => {
        if (!socket.userId) return;

        const roomId = chatId.toString();
        socket.join(roomId);

        console.log('📥 Joined chat room:', roomId);

        try {
            await connectDB();

            await Message.updateMany(
                {
                    chat: roomId,
                    sender: { $ne: socket.userId },
                    deliveredTo: { $ne: socket.userId },
                },
                { $addToSet: { deliveredTo: socket.userId } }
            );
        } catch (err) {
            console.log('❌ Delivery update error:', err);
        }
    });

    /* 💬 SEND MESSAGE */
    socket.on('send-message', async ({ chatId, text }) => {
        try {
            if (!socket.userId) return;

            await connectDB();

            const message = await Message.create({
                chat: chatId,
                sender: socket.userId,
                text,
                readBy: [socket.userId],
                deliveredTo: [socket.userId],
            });

            await Chat.findByIdAndUpdate(chatId, {
                updatedAt: new Date(),
            });

            io.to(chatId.toString()).emit('new-message', {
                _id: message._id.toString(),
                chat: chatId.toString(),
                sender: socket.userId,
                text: message.text,
                readBy: message.readBy,
                deliveredTo: message.deliveredTo,
                createdAt: message.createdAt,
            });

            console.log('📤 Message sent:', chatId);
        } catch (err) {
            console.log('❌ send-message error:', err);
        }
    });

    /* 🔴 DISCONNECT */
    socket.on('disconnect', () => {
        console.log('🔴 User disconnected:', socket.id);
    });
});

/* =========================
   START SERVER
========================= */
server.listen(PORT, () => {
    console.log(`🚀 Socket server running on port ${PORT}`);
});
