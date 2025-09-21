'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [name, setName] = useState(localStorage.getItem('chatName') || '');
  const [roomId, setRoomId] = useState('');
  const router = useRouter();

  const handleCreate = async (type: 'single' | 'group') => {
    if (!name.trim()) return alert('Enter your name');
    localStorage.setItem('chatName', name);

    const res = await fetch(`${process.env.NEXT_PUBLIC_SOCKET_URL}/create-${type}`);
    const data = await res.json();
    router.push(`/chat?room=${data.roomId}`);
  };

  const handleJoin = async() => {
    if (!name.trim() || !roomId.trim()) return alert('Enter name and room ID');
    localStorage.setItem('chatName', name);
    
    const res = await fetch(`${process.env.NEXT_PUBLIC_SOCKET_URL}/single-full/${roomId}`);
    const data = await res.json();
    if (data.full) {
      return alert('This single chat room is full. Please join or create a group chat.');
    }
    router.push(`/chat?room=${roomId}`);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center text-black">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold mb-4 text-center text-black">Chat App</h1>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Name"
          className="w-full p-2 mb-4 border rounded"
        />
        <div className="flex justify-between mb-4">
          <button onClick={() => handleCreate('single')} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
            Create Single Chat
          </button>
          <button onClick={() => handleCreate('group')} className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">
            Create Group Chat
          </button>
        </div>
        <div className="flex">
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID to Join"
            className="flex-1 p-2 border rounded-l"
          />
          <button onClick={handleJoin} className="bg-purple-500 text-white px-4 py-2 rounded-r hover:bg-purple-600">
            Join
          </button>
        </div>
      </div>
    </div>
  );
}