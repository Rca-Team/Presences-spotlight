import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hasTeacherAccess } from '@/utils/teacherAccess';

export type UserRole = 'admin' | 'principal' | 'teacher' | 'guard' | 'security' | 'enroller' | 'student_coordinator' | 'user' | null;

interface UseUserRoleReturn {
  role: UserRole;
  isLoading: boolean;
  isAdmin: boolean;
  isPrincipal: boolean;
  isTeacher: boolean;
  isGuard: boolean;
  isEnroller: boolean;
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

      // Fast check user_metadata for admin or enroller
      const metaRole = user.user_metadata?.role || user.app_metadata?.role;
      if (metaRole === 'admin') {
        roleCache.set(user.id, 'admin');
        setRole('admin');
        setIsLoading(false);
        return;
      }
      if (metaRole === 'enroller' || metaRole === 'student_coordinator') {
        roleCache.set(user.id, 'enroller');
        setRole('enroller');
        setIsLoading(false);
        return;
      }

      // Fetch user roles and profile safely
      const [userRolesRes, profileRes] = await Promise.all([
        db.from('user_roles').select('role').eq('user_id', user.id),
        db.from('profiles').select('role').eq('user_id', user.id).maybeSingle(),
      ]);

      const rolesList: string[] = (userRolesRes?.data || []).map((r: any) => r.role);
      if (profileRes?.data?.role) {
        rolesList.push(profileRes.data.role);
      }

      let resolved: UserRole = 'user';
      if (rolesList.includes('admin')) {
        resolved = 'admin';
      } else if (rolesList.includes('principal')) {
        resolved = 'principal';
      } else if (rolesList.includes('guard') || rolesList.includes('security')) {
        resolved = 'guard';
      } else if (rolesList.includes('enroller') || rolesList.includes('student_coordinator')) {
        resolved = 'enroller';
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

  const isEnroller = role === 'enroller' || role === 'student_coordinator';

  return {
    role,
    isLoading,
    isAdmin: role === 'admin',
    isPrincipal: role === 'principal' || role === 'admin',
    isTeacher: !isEnroller && (role === 'teacher' || role === 'admin' || role === 'principal'),
    isGuard: !isEnroller && (role === 'guard' || role === 'security' || role === 'admin'),
    isEnroller,
    isAdminOrPrincipal: role === 'admin' || role === 'principal',
    userId,
    refetch: fetchRole,
  };
};
