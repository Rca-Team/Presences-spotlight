import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hasTeacherAccess } from '@/utils/teacherAccess';

export type UserRole = 'admin' | 'principal' | 'teacher' | 'guard' | 'security' | 'user' | null;

interface UseUserRoleReturn {
  role: UserRole;
  isLoading: boolean;
  isAdmin: boolean;
  isPrincipal: boolean;
  isTeacher: boolean;
  isGuard: boolean;
  isAdminOrPrincipal: boolean;
  userId: string | null;
  refetch: () => Promise<void>;
}

const roleCache = new Map<string, UserRole>();

export const useUserRole = (): UseUserRoleReturn => {
  const db = supabase as any;
  const [role, setRole] = useState<UserRole>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchRole = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setRole(null);
        setUserId(null);
        setIsLoading(false);
        return;
      }

      setUserId(user.id);

      if (roleCache.has(user.id)) {
        setRole(roleCache.get(user.id)!);
        setIsLoading(false);
      }

      // Fast check user_metadata for admin
      if (user.user_metadata?.role === 'admin' || user.app_metadata?.role === 'admin') {
        roleCache.set(user.id, 'admin');
        setRole('admin');
        setIsLoading(false);
        return;
      }

      // Fetch user roles safely without .single() to avoid 406 when no role exists
      const { data: userRoles } = await db
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const rolesList: string[] = (userRoles || []).map((r: any) => r.role);

      let resolved: UserRole = 'user';
      if (rolesList.includes('admin')) {
        resolved = 'admin';
      } else if (rolesList.includes('principal')) {
        resolved = 'principal';
      } else if (rolesList.includes('guard') || rolesList.includes('security')) {
        resolved = 'guard';
      } else {
        const teacherAccess = await hasTeacherAccess(user.id);
        if (teacherAccess) {
          resolved = 'teacher';
        }
      }

      roleCache.set(user.id, resolved);
      setRole(resolved);
    } catch (error) {
      console.error('Error fetching user role:', error);
      setRole('user');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRole();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        fetchRole();
      } else if (event === 'SIGNED_OUT') {
        roleCache.clear();
        setRole(null);
        setUserId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchRole]);

  return {
    role,
    isLoading,
    isAdmin: role === 'admin',
    isPrincipal: role === 'principal' || role === 'admin',
    isTeacher: role === 'teacher' || role === 'admin' || role === 'principal',
    isGuard: role === 'guard' || role === 'security' || role === 'admin',
    isAdminOrPrincipal: role === 'admin' || role === 'principal',
    userId,
    refetch: fetchRole,
  };
};
