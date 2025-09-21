'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';

let socket: Socket | null = null;

export default function Chat() {
    const [messages, setMessages] = useState<{ user?: string; text: string; system?: boolean }[]>([]);
    const [input, setInput] = useState('');
    const searchParams = useSearchParams();
    const router = useRouter();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const roomId = searchParams.get('room');
    const userName = localStorage.getItem('chatName');

    useEffect(() => {
        if (!roomId || !userName) {
            router.push('/');
            return;
        }

        socket = io('http://localhost:5000');

        socket.emit('join room', { roomId, userName });

        socket.on('chat history', (history) => {
            setMessages(history);
        });

        socket.on('chat message', (msg) => {
            setMessages((prev) => [...prev, msg]);
        });

        socket.on('user joined', (msg) => {
            setMessages((prev) => [...prev, { system: true, text: msg }]);
        });

        socket.on('user left', (msg) => {
            setMessages((prev) => [...prev, { system: true, text: msg }]);
        });

        socket.on('error', (err) => {
            alert(err);
            if (socket) socket.disconnect();
            router.push('/');
        });

        return () => {
            if (socket) {
                socket.disconnect();
                socket = null;
            }
        };
    }, [roomId, userName, router]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && socket) {
            socket.emit('chat message', input);
            setInput('');
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
            {/* copy button alongside room ID */}
            <header className="bg-blue-600  p-4 text-center font-bold">Chat Room: {roomId} <button onClick={() => navigator.clipboard.writeText(roomId!)} className='bg-blue-500 text-white px-2 py-1 rounded ml-2 hover:bg-blue-600'>Copy</button></header>
            <div className="flex-1 p-4 overflow-y-auto bg-white m-4 rounded-lg shadow text-black">
                {messages.map((msg, index) => (
                    <div key={index} className={`mb-2 ${msg.system ? 'text-center text-black' : ''}`}>
                        {msg.system ? (
                            msg.text
                        ) : (
                            <>
                                <span className="font-semibold">{msg.user}: </span>
                                {msg.text}
                            </>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-4 bg-gray-200 flex text-black">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 p-2 border rounded-l "
                />
                <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded-r hover:bg-blue-600">
                    Send
                </button>
            </form>
        </div>
    );
}