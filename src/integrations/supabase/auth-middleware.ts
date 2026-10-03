import { appwriteUnifiedClient } from '../appwrite/adapter';
import { Account, Client } from 'node-appwrite';

export interface SupabaseAuthContext {
  supabase: any;
  userId: string;
  claims: Record<string, unknown>;
}

export async function requireSupabaseAuth(request: Request): Promise<SupabaseAuthContext> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new Response('Authentication required', { status: 401 });
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.VITE_APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID || process.env.VITE_APPWRITE_PROJECT_ID;
  if (!endpoint || !project) throw new Response('Server authentication is not configured', { status: 503 });
  const authClient = new Client().setEndpoint(endpoint).setProject(project).setJWT(token);
  let user;
  try {
    user = await new Account(authClient).get();
  } catch (error: any) {
    if (error?.code === 401 || error?.code === 403) throw new Response('Invalid authentication', { status: 401 });
    throw new Response('Authentication service unavailable', { status: 503 });
  }

  return {
    supabase: appwriteUnifiedClient,
    userId: user.$id,
    claims: { sub: user.$id, labels: user.labels },
  };
}
