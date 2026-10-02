'use client';

import { useState } from 'react';
import { useAuth } from '@appwrite.io/react';
import { useRouter } from 'next/navigation';

export function AuthPanel() {
    const { user, isLoading, signIn, signUp, signOut, error } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');

    if (isLoading) return <p>Loading...</p>;

    if (user) {
        return (
            <div style={{ marginTop: '1rem' }}>
                <p>Welcome, {user.name || user.email}!</p>
                <button
                    style={{ padding: '8px 16px', cursor: 'pointer' }}
                    onClick={() => signOut.signOut({ onSuccess: () => router.refresh() })}
                >
                    Sign out
                </button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '320px', marginTop: '1rem' }}>
            <input
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ padding: '8px' }}
            />
            <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ padding: '8px' }}
            />
            <input
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ padding: '8px' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                    style={{ padding: '8px 16px', cursor: 'pointer', flex: 1 }}
                    onClick={() =>
                        signUp.emailPassword({
                            email,
                            password,
                            name,
                            onSuccess: () => router.refresh()
                        })
                    }
                >
                    Sign up
                </button>
                <button
                    style={{ padding: '8px 16px', cursor: 'pointer', flex: 1 }}
                    onClick={() =>
                        signIn.emailPassword({ email, password, onSuccess: () => router.refresh() })
                    }
                >
                    Sign in
                </button>
            </div>
            {error && <p style={{ color: 'red', marginTop: '8px' }}>{error.message}</p>}
        </div>
    );
}
