import type { Database } from './types';
import { appwriteUnifiedClient } from '../appwrite/adapter';

// Seamless Supabase-compatible client backed 100% by Appwrite Cloud
export const supabase: any = appwriteUnifiedClient;


