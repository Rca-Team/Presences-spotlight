import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import NotificationPermissionGate from './NotificationPermissionGate';
import { ShieldAlert } from 'lucide-react';
import { hasTeacherAccess } from '@/utils/teacherAccess';

type AppRole = 'admin' | 'principal' | 'teacher' | 'guard' | 'security' | 'enroller' | 'student_coordinator' | 'user';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireRoles?: AppRole[];
}

export function ProtectedRoute({ children, requireAdmin = false, requireRoles }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentRole, setCurrentRole] = useState<AppRole | null>(null);

  const resolveUserRole = async (userId: string, email?: string): Promise<AppRole> => {
    const db = supabase as any;

    const [userRolesRes, profileRes] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', userId),
      db.from('profiles').select('role').eq('user_id', userId).maybeSingle(),
    ]);

    const rolesList: string[] = (userRolesRes?.data || []).map((r: any) => r.role);
    if (profileRes?.data?.role) {
      rolesList.push(profileRes.data.role);
    }

    if (rolesList.includes('admin')) return 'admin';
    if (rolesList.includes('principal')) return 'principal';
    if (rolesList.includes('guard') || rolesList.includes('security')) return 'guard';
    if (rolesList.includes('enroller') || rolesList.includes('student_coordinator')) return 'enroller';

    if (await hasTeacherAccess(userId)) return 'teacher';

    return 'user';
  };

  const hasRequiredRole = (role: AppRole, required?: AppRole[]) => {
    if (!required || required.length === 0) return true;
    if (role === 'admin') return true; // Superadmin has universal access to all routes
    if (role === 'principal' && (required.includes('principal') || required.includes('teacher') || required.includes('user'))) return true;
    if ((role === 'enroller' || role === 'student_coordinator') && (required.includes('enroller') || required.includes('student_coordinator'))) return true;
    return required.includes(role);
  };

  const rolesKey = (requireRoles || []).join(',');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setIsAuthorized(false);
    const checkAuth = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        
        if (!user) {
          setIsAuthenticated(false);
          if (location.pathname !== '/login') {
            navigate('/login', {
              replace: true,
              state: {
                from: `${location.pathname}${location.search}${location.hash}`,
              },
            });
          }
          return;
        }

        setIsAuthenticated(true);

        const role = await resolveUserRole(user.id, user.email);
        if (!active) return;
        setCurrentRole(role);

        const effectiveRequiredRoles = requireAdmin
          ? ['admin'] as AppRole[]
          : requireRoles;

        setIsAuthorized(hasRequiredRole(role, effectiveRequiredRoles));
      } catch (error) {
        console.error('Auth check error:', error);
        setIsAuthenticated(false);
        if (location.pathname !== '/login') {
          navigate('/login', {
            replace: true,
            state: {
              from: `${location.pathname}${location.search}${location.hash}`,
            },
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_OUT' || !session) && location.pathname !== '/login') {
        setIsAuthenticated(false);
        setIsAuthorized(false);
        navigate('/login', {
          replace: true,
          state: {
            from: `${location.pathname}${location.search}${location.hash}`,
          },
        });
      }
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, [navigate, location.pathname, location.search, location.hash, requireAdmin, requireRoles ? requireRoles.join(',') : '']);

  if (loading) {
    return null;
  }

  if (!isAuthenticated) return null;

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-500/15 flex items-center justify-center">
            <ShieldAlert className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-white">Access denied</h1>
          <p className="text-slate-300 text-sm">
            You don’t have permission to view this page.
          </p>
          <p className="text-xs text-slate-400">
            Current role: <span className="text-slate-200 font-medium">{currentRole ?? 'unknown'}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <NotificationPermissionGate>
      {children}
    </NotificationPermissionGate>
  );
}
