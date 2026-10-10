import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import NotificationPermissionGate from './NotificationPermissionGate';
import { ShieldAlert, Home, LogOut } from 'lucide-react';
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

  const resolveUserRole = async (userId: string, email?: string, userObj?: any): Promise<AppRole> => {
    // 0. Superadmin bypass: full access to everything for atl@gmail.com
    const cleanEmail = String(email || userObj?.email || '').toLowerCase().trim();
    if (cleanEmail === 'atl@gmail.com') return 'admin';

    // 1. Check user metadata / claims / Appwrite labels
    const metaRole = String(userObj?.user_metadata?.role || userObj?.app_metadata?.role || '').toLowerCase();
    const labels: string[] = (userObj?.app_metadata?.labels || userObj?.user_metadata?.labels || []).map((l: any) => String(l).toLowerCase());

    if (metaRole === 'admin' || labels.includes('admin') || labels.includes('superadmin')) return 'admin';
    if (metaRole === 'principal' || labels.includes('principal')) return 'principal';
    if (metaRole === 'enroller' || metaRole === 'student_coordinator' || labels.includes('enroller') || labels.includes('student_coordinator')) return 'enroller';
    if (metaRole === 'guard' || metaRole === 'security' || labels.includes('guard') || labels.includes('security')) return 'guard';
    if (metaRole === 'teacher' || labels.includes('teacher')) return 'teacher';

    const db = supabase as any;

    const [userRolesRes, profileRes] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', userId),
      db.from('profiles').select('role').eq('user_id', userId).maybeSingle(),
    ]);

    const rolesList: string[] = (userRolesRes?.data || []).map((r: any) => String(r.role).toLowerCase());
    if (profileRes?.data?.role) {
      rolesList.push(String(profileRes.data.role).toLowerCase());
    }

    if (email && rolesList.length === 0) {
      try {
        const { data: p } = await db.from('profiles').select('role').eq('email', email).maybeSingle();
        if (p?.role) rolesList.push(String(p.role).toLowerCase());
      } catch (_) {}
    }

    if (rolesList.includes('admin') || rolesList.includes('superadmin')) return 'admin';
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

        const role = await resolveUserRole(user.id, user.email, user);
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
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 sm:p-7 text-center space-y-4 shadow-2xl">
          <div className="mx-auto h-14 w-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center shadow-lg shadow-red-500/10">
            <ShieldAlert className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Access denied</h1>
          <p className="text-slate-300 text-sm leading-relaxed">
            You don’t have permission to view this page. This section is restricted to authorized school staff.
          </p>
          <div className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-slate-400">
            Current role: <span className="text-emerald-400 font-semibold uppercase tracking-wider">{currentRole ?? 'user'}</span>
          </div>
          <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto border-white/20 text-white hover:bg-white/10 text-xs font-semibold gap-1.5"
              onClick={() => navigate('/')}
            >
              <Home className="w-3.5 h-3.5" />
              Go to Home
            </Button>
            <Button
              variant="default"
              size="sm"
              className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5 shadow-md shadow-emerald-500/20"
              onClick={() => navigate('/attendance')}
            >
              Attendance Hub
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto text-slate-400 hover:text-white text-xs gap-1.5"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/login');
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
              Switch Account
            </Button>
          </div>
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
