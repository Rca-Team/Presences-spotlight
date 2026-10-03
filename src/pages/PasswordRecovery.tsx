import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { account } from '@/integrations/appwrite/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PasswordRecovery() {
  const [params] = useSearchParams();
  const userId = params.get('userId');
  const secret = params.get('secret');
  const resetting = Boolean(userId && secret);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (resetting && password !== confirm) { setError('Passwords do not match.'); return; }
    setPending(true);
    try {
      if (resetting) {
        await account.updateRecovery(userId!, secret!, password);
        setMessage('Password updated. You can now sign in.');
        setPassword(''); setConfirm(''); setDone(true);
      } else {
        await account.createRecovery(email.trim(), window.location.origin + '/reset-password');
        setMessage('Check your inbox for the password reset link.');
      }
    } catch (failure: any) {
      setError(failure?.message || 'The request failed. Please try again.');
    } finally { setPending(false); }
  }

  return <main className="min-h-screen flex items-center justify-center bg-background p-6">
    <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <h1 className="text-2xl font-semibold">{resetting ? 'Set a new password' : 'Reset your password'}</h1>
      <p className="text-sm text-muted-foreground">{resetting ? 'Use at least 8 characters.' : 'Enter the email address you use to sign in.'}</p>
      {!done && <form onSubmit={submit} className="space-y-4">
        {resetting ? <>
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} />
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} />
        </> : <>
          <Label htmlFor="recovery-email">Email</Label>
          <Input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </>}
        <Button disabled={pending} type="submit" className="w-full">{pending ? 'Please wait…' : resetting ? 'Update password' : 'Send reset link'}</Button>
      </form>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
      <Link to="/login" className="block text-sm text-primary">Back to sign in</Link>
    </div>
  </main>;
}
