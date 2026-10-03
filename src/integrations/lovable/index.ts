// Appwrite Native OAuth & Cross-platform Auth integration (replaces Lovable cloud-auth-js)

import { account, OAuthProvider } from "../appwrite/client";
import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

type OAuthProviderName = 'google' | 'github' | 'apple' | 'azure' | 'facebook' | string;

const PROVIDER_MAP: Record<string, OAuthProvider> = {
  google: OAuthProvider.Google,
  github: OAuthProvider.Github,
  apple: OAuthProvider.Apple,
  azure: OAuthProvider.Microsoft,
  microsoft: OAuthProvider.Microsoft,
  facebook: OAuthProvider.Facebook,
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: OAuthProviderName, opts?: SignInOptions) => {
      try {
        const redirectUrl = opts?.redirect_uri || (typeof window !== 'undefined' ? `${window.location.origin}/login` : '');
        const appwriteProvider = PROVIDER_MAP[provider?.toLowerCase()] || (provider as OAuthProvider) || OAuthProvider.Google;

        // Directly invoke Appwrite Cloud native OAuth session creation
        if (account && typeof account.createOAuth2Session === 'function') {
          await account.createOAuth2Session(appwriteProvider, redirectUrl, redirectUrl);
          return { redirected: true };
        }

        // Fallback to supabase adapter if account is unavailable
        if (supabase?.auth && typeof supabase.auth.signInWithOAuth === 'function') {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
              redirectTo: redirectUrl,
              queryParams: opts?.extraParams,
            },
          });
          if (error) return { error };
          if (data?.url) return { redirected: true };
          return data;
        }

        throw new Error('Authentication client is not initialized for OAuth');
      } catch (e: any) {
        console.error('[OAuth] Sign-in error:', e);
        return { error: e instanceof Error ? e : new Error(String(e?.message || e)) };
      }
    },
  },
};

export default lovable;
