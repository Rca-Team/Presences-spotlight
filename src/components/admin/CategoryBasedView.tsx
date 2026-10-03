import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Users, User, Printer, Calendar, Bell, ChevronLeft, GraduationCap,
  FileText, Download, FolderInput, MoreVertical, CalendarClock,
  Search, CheckCircle2, XCircle, Clock, ArrowRight, UserCheck,
  Sparkles, RefreshCw, Layers
} from 'lucide-react';
import ClassTeacherManager from './ClassTeacherManager';
import FullTimetableManager from './TimetableManager';
import { supabase } from '@/integrations/supabase/client';
import { pushNotificationService } from '@/services/PushNotificationService';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { filterWorkingDaysForSchool } from '@/utils/workingDays';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ChangeCategoryDialog from './ChangeCategoryDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  CLASSES, SECTIONS, CLASS_COLORS, getCategoryLabel, getCategoryShortLabel,
  type Category, type SchoolClass 
} from '@/constants/schoolConfig';
import { resolveStudentPhotoUrl } from '@/utils/studentPhotoResolver';

export interface CategoryUser {
  id: string;
  user_id?: string;
  name: string;
  employee_id: string;
  roll_number?: string;
  admission_number?: string;
  department: string;
  image_url: string;
  category: string;
  class: string;
  section: string;
  role: 'student' | 'teacher' | 'admin' | 'staff';
  parent_name?: string;
  parent_phone?: string;
  parent_email?: string;
  phone?: string;
  isPresentToday: boolean;
  attendanceStatus?: 'present' | 'late' | 'absent';
}

const CategoryBasedView: React.FC = () => {
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState<number | string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [users, setUsers] = useState<CategoryUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Notification dialog states
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationSubject, setNotificationSubject] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [sendingNotification, setSendingNotification] = useState(false);
  
  // Print & Timetable states
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [showTeacherManager, setShowTeacherManager] = useState(false);
  const [fullTimetableOpen, setFullTimetableOpen] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch all profiles (source of truth for registered students & staff)
      let allProfiles: any[] = [];
      let offset = 0;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const { data: page, error: pErr } = await supabase
          .from('profiles')
          .select('*')
          .range(offset, offset + pageSize - 1);

        if (pErr) {
          console.warn('[CategoryBasedView] Profiles query warning:', pErr);
          hasMore = false;
        } else if (page && page.length > 0) {
          allProfiles = allProfiles.concat(page);
          if (page.length < pageSize) hasMore = false;
          else offset += pageSize;
        } else {
          hasMore = false;
        }
      }

      // 2. Fetch registered attendance records as auxiliary fallback
      const { data: registrationRecords } = await supabase
        .from('attendance_records')
        .select('id, user_id, device_info, image_url, category, timestamp')
        .eq('status', 'registered');

      // 3. Fetch today's attendance logs (to display live Present vs Absent statuses)
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: todayAttendance } = await supabase
        .from('attendance_records')
        .select('user_id, student_id, student_name, device_info, status, timestamp')
        .in('status', ['present', 'late'])
        .gte('timestamp', `${today}T00:00:00`)
        .lte('timestamp', `${today}T23:59:59`);

      // Build present lookup sets
      const presentUserIds = new Set<string>();
      const presentStudentIds = new Set<string>();
      const presentNames = new Set<string>();

      (todayAttendance || []).forEach((row: any) => {
        if (row.user_id) presentUserIds.add(String(row.user_id));
        if (row.student_id) presentStudentIds.add(String(row.student_id).toLowerCase().trim());
        const di = typeof row.device_info === 'string' ? safeJsonParse(row.device_info) : row.device_info;
        const emp = di?.metadata?.employee_id || di?.employee_id;
        if (emp) presentStudentIds.add(String(emp).toLowerCase().trim());
        const name = row.student_name || di?.metadata?.name || di?.name;
        if (name) presentNames.add(String(name).toLowerCase().trim());
      });

      const processedMap = new Map<string, CategoryUser>();

      // Process Profiles
      for (const p of allProfiles) {
        const id = p.id || p.user_id || p.$id;
        if (!id) continue;

        const pm = typeof p.metadata === 'string' ? safeJsonParse(p.metadata) : p.metadata || {};
        const name = p.display_name || p.full_name || pm.name || 'Student';
        const roleStr = String(p.role || pm.role || '').toLowerCase();
        const isTeacher = roleStr === 'teacher' || roleStr === 'staff' || String(p.department || '').toLowerCase() === 'teacher';

        let studentClass = String(p.class || pm.class || '').trim();
        let studentSection = String(p.section || pm.section || 'A').toUpperCase().trim();

        // Extract class from department if missing
        if (!studentClass && p.department) {
          const match = p.department.match(/\d+/);
          if (match) studentClass = match[0];
        }

        // Default student class fallback if unassigned
        if (!isTeacher && !studentClass) {
          studentClass = '6';
        }

        const category = isTeacher ? 'Teacher' : `${studentClass}-${studentSection || 'A'}`;
        const employeeId = p.admission_number || p.roll_number || p.employee_id || pm.employee_id || pm.roll_number || 'N/A';
        const rawPhoto = p.avatar_url || p.photo_url || pm.photo_url || '';

        const isPresent = (
          (p.user_id && presentUserIds.has(String(p.user_id))) ||
          (id && presentUserIds.has(String(id))) ||
          (employeeId !== 'N/A' && presentStudentIds.has(String(employeeId).toLowerCase().trim())) ||
          presentNames.has(name.toLowerCase().trim())
        );

        const canonicalKey = (employeeId && employeeId !== 'N/A')
          ? `emp:${employeeId.toLowerCase()}`
          : `uid:${p.user_id || id}`;

        processedMap.set(canonicalKey, {
          id: id,
          user_id: p.user_id || id,
          name,
          employee_id: employeeId,
          roll_number: p.roll_number || pm.roll_number,
          admission_number: p.admission_number || pm.admission_number,
          department: p.department || (isTeacher ? 'Faculty' : `Class ${studentClass}-${studentSection}`),
          image_url: rawPhoto,
          category,
          class: isTeacher ? 'Teacher' : studentClass,
          section: isTeacher ? '' : (studentSection || 'A'),
          role: isTeacher ? 'teacher' : 'student',
          parent_name: p.parent_name || pm.parent_name,
          parent_phone: p.parent_phone || pm.parent_phone || p.phone,
          parent_email: p.parent_email || pm.parent_email,
          phone: p.phone,
          isPresentToday: isPresent,
          attendanceStatus: isPresent ? 'present' : 'absent',
        });
      }

      // Process auxiliary attendance registration records
      for (const rec of registrationRecords || []) {
        const di = typeof rec.device_info === 'string' ? safeJsonParse(rec.device_info) : rec.device_info;
        const meta = di?.metadata || {};
        const name = meta.name || di?.name || 'Unknown';
        if (name === 'Unknown') continue;

        const employeeId = meta.employee_id || di?.employee_id || 'N/A';
        const canonicalKey = (employeeId && employeeId !== 'N/A')
          ? `emp:${employeeId.toLowerCase()}`
          : `uid:${rec.user_id || rec.id}`;

        if (!processedMap.has(canonicalKey)) {
          let category = rec.category || meta.department || '6-A';
          let cls = '6';
          let sec = 'A';
          if (category === 'Teacher') {
            cls = 'Teacher';
            sec = '';
          } else {
            const match = category.match(/^(\d+)-?([A-D])?$/i);
            if (match) {
              cls = match[1];
              sec = (match[2] || 'A').toUpperCase();
              category = `${cls}-${sec}`;
            }
          }

          const isPresent = (
            (rec.user_id && presentUserIds.has(String(rec.user_id))) ||
            (employeeId !== 'N/A' && presentStudentIds.has(String(employeeId).toLowerCase().trim())) ||
            presentNames.has(name.toLowerCase().trim())
          );

          processedMap.set(canonicalKey, {
            id: rec.id,
            user_id: rec.user_id,
            name,
            employee_id: employeeId,
            roll_number: meta.roll_number,
            department: meta.department || `Class ${cls}-${sec}`,
            image_url: rec.image_url || meta.firebase_image_url || '',
            category,
            class: cls,
            section: sec,
            role: category === 'Teacher' ? 'teacher' : 'student',
            parent_name: meta.parent_name,
            parent_phone: meta.parent_phone || meta.phone,
            parent_email: meta.parent_email,
            isPresentToday: isPresent,
            attendanceStatus: isPresent ? 'present' : 'absent',
          });
        }
      }

      const userList = Array.from(processedMap.values());
      // Resolve photo URLs asynchronously
      const resolvedList = await Promise.all(
        userList.map(async (u) => ({
          ...u,
          image_url: await resolveStudentPhotoUrl(u.image_url),
        }))
      );

      setUsers(resolvedList);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({ title: 'Error', description: 'Failed to load class data', variant: 'destructive' });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchUsers();
  };

  // Helper for safe JSON parsing
  function safeJsonParse(val: any) {
    if (!val || typeof val !== 'string') return {};
    try {
      return JSON.parse(val);
    } catch {
      return {};
    }
  }

  // Summary counts
  const totalStudents = useMemo(() => users.filter(u => u.role === 'student').length, [users]);
  const totalTeachers = useMemo(() => users.filter(u => u.role === 'teacher').length, [users]);
  const presentTodayCount = useMemo(() => users.filter(u => u.role === 'student' && u.isPresentToday).length, [users]);
  const overallAttendanceRate = totalStudents > 0 ? Math.round((presentTodayCount / totalStudents) * 100) : 0;

  // Breakdown by Class
  const classStats = useMemo(() => {
    const stats: Record<string, { total: number; present: number; sections: Record<string, { total: number; present: number }> }> = {};

    CLASSES.forEach(c => {
      const classStr = String(c);
      stats[classStr] = { total: 0, present: 0, sections: { 'A': { total: 0, present: 0 }, 'B': { total: 0, present: 0 }, 'C': { total: 0, present: 0 }, 'D': { total: 0, present: 0 } } };
    });

    users.forEach(u => {
      if (u.role === 'teacher') return;
      const c = u.class;
      const s = u.section || 'A';

      if (!stats[c]) {
        stats[c] = { total: 0, present: 0, sections: {} };
      }
      if (!stats[c].sections[s]) {
        stats[c].sections[s] = { total: 0, present: 0 };
      }

      stats[c].total += 1;
      stats[c].sections[s].total += 1;
      if (u.isPresentToday) {
        stats[c].present += 1;
        stats[c].sections[s].present += 1;
      }
    });

    return stats;
  }, [users]);

  // Filtered users for Section level view
  const sectionUsers = useMemo(() => {
    if (!selectedCategory) return [];
    let list = users.filter(u => u.category === selectedCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(u => 
        u.name.toLowerCase().includes(q) || 
        u.employee_id.toLowerCase().includes(q) ||
        (u.roll_number && u.roll_number.toLowerCase().includes(q))
      );
    }
    return list;
  }, [users, selectedCategory, searchQuery]);

  // Print Daily Attendance
  const handlePrintDailyAttendance = async () => {
    if (!selectedCategory) return;
    const categoryUsers = sectionUsers;
    const today = format(new Date(), 'dd MMMM yyyy');

    const printContent = `
      <html><head>
        <title>Daily Attendance - ${getCategoryLabel(selectedCategory)} - ${today}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 25px; color: #1e293b; }
          .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
          .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
          .subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }
          .badge-bar { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 13px; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background-color: #f1f5f9; color: #334155; font-weight: 600; }
          .present { color: #15803d; font-weight: 700; }
          .absent { color: #b91c1c; font-weight: 700; }
          .footer { margin-top: 30px; text-align: right; font-size: 11px; color: #94a3b8; }
        </style>
      </head><body>
        <div class="header">
          <h1 class="title">PM SHRI KENDRIYA VIDYALAYA NFC VIGYAN VIHAR</h1>
          <div class="subtitle">Daily Attendance Register • ${getCategoryLabel(selectedCategory)} • ${today}</div>
        </div>
        <div class="badge-bar">
          <div>Total Enrolled: ${categoryUsers.length}</div>
          <div>Present: ${categoryUsers.filter(u => u.isPresentToday).length} | Absent: ${categoryUsers.filter(u => !u.isPresentToday).length}</div>
        </div>
        <table><thead><tr><th>#</th><th>Student Name</th><th>Roll No</th><th>Admission / ID</th><th>Today's Status</th></tr></thead>
        <tbody>${categoryUsers.map((u, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${u.name}</strong></td>
            <td>${u.roll_number || '-'}</td>
            <td>${u.employee_id}</td>
            <td class="${u.isPresentToday ? 'present' : 'absent'}">${u.isPresentToday ? 'PRESENT' : 'ABSENT'}</td>
          </tr>
        `).join('')}</tbody></table>
        <div class="footer"><p>Generated via Presences Smart School Cloud • ${format(new Date(), 'dd-MM-yyyy HH:mm')}</p></div>
      </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(printContent); w.document.close(); w.print(); }
  };

  // Bulk Notification to Parents
  const handleBulkNotification = async () => {
    if (!selectedCategory || !notificationMessage.trim()) return;
    setSendingNotification(true);
    try {
      const categoryUsers = sectionUsers;
      let successCount = 0;
      let failCount = 0;

      for (const user of categoryUsers) {
        if (!user.user_id && !user.id) continue;
        if (user.parent_email || user.parent_phone) {
          try {
            await supabase.functions.invoke('send-notification', {
              body: {
                recipient: {
                  email: user.parent_email,
                  name: user.parent_name || 'Parent',
                  phone: user.parent_phone || user.phone || null,
                },
                message: {
                  subject: notificationSubject || `${getCategoryLabel(selectedCategory)} Announcement`,
                  body: notificationMessage,
                },
                student: {
                  id: user.user_id || user.id,
                  name: user.name,
                  status: 'notification',
                },
                targetUserId: user.user_id || user.id,
              },
            });
            successCount++;
          } catch {
            failCount++;
          }
        }
      }

      toast({
        title: 'Broadcast Sent',
        description: `Delivered to ${successCount} parent contacts${failCount > 0 ? `, ${failCount} pending/failed` : ''}.`,
      });

      if (successCount > 0) {
        pushNotificationService.showLocalNotification(`📣 Announcement sent to ${getCategoryLabel(selectedCategory)}`, {
          body: `${successCount} parents received announcement.`,
        }).catch(() => undefined);
      }

      setNotificationOpen(false);
      setNotificationMessage('');
      setNotificationSubject('');
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to broadcast notification', variant: 'destructive' });
    } finally {
      setSendingNotification(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="bg-card/40 border-border/40">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <Card key={i} className="h-44 bg-card/40 border-border/40" />
          ))}
        </div>
      </div>
    );
  }

  // LEVEL 3: View students in a specific section / category
  if (selectedCategory) {
    return (
      <div className="space-y-6">
        {/* Top Breadcrumb & Action Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-2xl bg-card/50 border border-border/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-10 w-10 rounded-xl hover:bg-primary/10"
              onClick={() => setSelectedCategory(null)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{getCategoryLabel(selectedCategory)}</h2>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {sectionUsers.length} {selectedCategory === 'Teacher' ? 'Teachers' : 'Students'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedCategory === 'Teacher' 
                  ? 'Faculty roster & assigned subjects' 
                  : `Present Today: ${sectionUsers.filter(u => u.isPresentToday).length} / ${sectionUsers.length}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {selectedCategory !== 'Teacher' && (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="rounded-xl border-border/70"
                  onClick={() => setShowTeacherManager(true)}
                >
                  <Users className="h-4 w-4 mr-2 text-indigo-400" />
                  Class Teacher
                </Button>

                <Dialog open={fullTimetableOpen} onOpenChange={setFullTimetableOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="rounded-xl border-border/70">
                      <CalendarClock className="h-4 w-4 mr-2 text-amber-400" />
                      Timetable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Timetable — {getCategoryLabel(selectedCategory)}</DialogTitle>
                    </DialogHeader>
                    <FullTimetableManager allowedCategories={[selectedCategory]} />
                  </DialogContent>
                </Dialog>
              </>
            )}

            <Button 
              variant="outline" 
              size="sm" 
              className="rounded-xl border-border/70"
              onClick={handlePrintDailyAttendance}
            >
              <Printer className="h-4 w-4 mr-2 text-emerald-400" />
              Daily Sheet
            </Button>

            <Dialog open={notificationOpen} onOpenChange={setNotificationOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md">
                  <Bell className="h-4 w-4 mr-2" />
                  Broadcast
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Broadcast to {getCategoryLabel(selectedCategory)}</DialogTitle>
                  <CardDescription>Send instant announcement to parents via notification and email.</CardDescription>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Subject</Label>
                    <Input 
                      value={notificationSubject} 
                      onChange={(e) => setNotificationSubject(e.target.value)} 
                      placeholder="e.g. Important Class Notice" 
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>Message Content</Label>
                    <Textarea 
                      value={notificationMessage} 
                      onChange={(e) => setNotificationMessage(e.target.value)} 
                      placeholder="Enter announcement message..." 
                      rows={4} 
                      className="mt-1.5"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Will be delivered to {sectionUsers.length} student parent contacts.</p>
                  <Button 
                    onClick={handleBulkNotification} 
                    disabled={!notificationMessage.trim() || sendingNotification} 
                    className="w-full rounded-xl"
                  >
                    {sendingNotification ? 'Delivering...' : 'Send Broadcast'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search bar inside section */}
        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${getCategoryLabel(selectedCategory)} by name or ID...`}
            className="pl-10 rounded-xl bg-card/40 border-border/60"
          />
        </div>

        {/* Student / Teacher Cards Grid */}
        {sectionUsers.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-border/80 bg-card/20 rounded-2xl">
            <User className="h-12 w-12 mx-auto text-muted-foreground/60 mb-3" />
            <h3 className="text-lg font-semibold">No records found</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
              {searchQuery ? `No results matching "${searchQuery}"` : `No students currently assigned to ${getCategoryLabel(selectedCategory)}.`}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sectionUsers.map(user => (
              <Card 
                key={user.id} 
                className="overflow-hidden bg-card/60 border-border/50 hover:border-primary/40 hover:shadow-lg transition-all rounded-2xl backdrop-blur-sm group"
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3.5">
                    <div className="relative">
                      <Avatar className="h-12 w-12 rounded-xl ring-2 ring-border/50 group-hover:ring-primary/40 transition-all">
                        <AvatarImage src={user.image_url} alt={user.name} />
                        <AvatarFallback className="rounded-xl font-bold bg-primary/10 text-primary">
                          {user.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      {user.role === 'student' && (
                        <span 
                          className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-background ${user.isPresentToday ? 'bg-emerald-500' : 'bg-rose-500'}`} 
                          title={user.isPresentToday ? 'Present Today' : 'Absent Today'}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm truncate text-foreground group-hover:text-primary transition-colors">
                        {user.name}
                      </h4>
                      <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">
                        ID: {user.employee_id}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {user.roll_number && (
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Roll #{user.roll_number}
                          </span>
                        )}
                        {user.role === 'student' && (
                          <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${user.isPresentToday ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                            {user.isPresentToday ? 'Present' : 'Absent'}
                          </span>
                        )}
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl">
                        <ChangeCategoryDialog
                          userId={user.user_id || user.id} 
                          userName={user.name} 
                          currentCategory={user.category}
                          onCategoryChanged={fetchUsers}
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-pointer">
                              <FolderInput className="h-4 w-4 mr-2 text-primary" />
                              Change Class / Section
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // LEVEL 2: View Sections of Selected Class
  if (selectedClass !== null) {
    const classNum = String(selectedClass);
    const currClassStats = classStats[classNum] || { total: 0, present: 0, sections: {} };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 rounded-2xl bg-card/50 border border-border/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-10 w-10 rounded-xl"
              onClick={() => setSelectedClass(null)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight">Class {selectedClass}</h2>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {currClassStats.total} Enrolled
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Today's Attendance: <span className="text-emerald-400 font-semibold">{currClassStats.present} Present</span> of {currClassStats.total} ({currClassStats.total > 0 ? Math.round((currClassStats.present / currClassStats.total) * 100) : 0}%)
              </p>
            </div>
          </div>

          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-xl"
            onClick={() => setSelectedClass(null)}
          >
            All Classes
          </Button>
        </div>

        {/* Sections Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {SECTIONS.map(section => {
            const cat = `${selectedClass}-${section}`;
            const secInfo = currClassStats.sections[section] || { total: 0, present: 0 };
            const attendancePct = secInfo.total > 0 ? Math.round((secInfo.present / secInfo.total) * 100) : 0;
            const classColor = typeof selectedClass === 'number' ? CLASS_COLORS[selectedClass] : 'bg-cyan-500';

            return (
              <Card 
                key={section}
                className="cursor-pointer border-border/50 bg-card/60 backdrop-blur-md hover:border-primary/50 hover:shadow-xl transition-all duration-300 rounded-2xl group hover:-translate-y-1"
                onClick={() => setSelectedCategory(cat)}
              >
                <CardContent className="p-6 text-center">
                  <div className={`w-14 h-14 ${classColor || 'bg-blue-500'} rounded-2xl flex items-center justify-center mx-auto mb-4 text-white font-extrabold text-2xl shadow-lg group-hover:scale-105 transition-transform`}>
                    {section}
                  </div>
                  <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                    Section {section}
                  </h3>
                  
                  <div className="mt-2.5 flex items-center justify-center gap-1.5">
                    <Badge variant="secondary" className="font-mono text-xs font-semibold px-2.5 py-0.5 rounded-lg">
                      <Users className="h-3 w-3 mr-1 text-primary" />
                      {secInfo.total} {secInfo.total === 1 ? 'student' : 'students'}
                    </Badge>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground flex items-center justify-between">
                    <span>Today's Present:</span>
                    <span className="font-semibold text-emerald-400">
                      {secInfo.present} ({attendancePct}%)
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // LEVEL 1: Main Classes & Sections Dashboard
  return (
    <div className="space-y-6">
      {/* Top School Enrolled Summary Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-card/80 to-blue-500/5 backdrop-blur-md shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Enrolled</p>
              <h3 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">{totalStudents}</h3>
              <p className="text-[11px] text-blue-400 font-medium mt-1">Verified Students</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Users className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-card/80 to-emerald-500/5 backdrop-blur-md shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Present Today</p>
              <h3 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                {presentTodayCount} <span className="text-sm font-normal text-muted-foreground">({overallAttendanceRate}%)</span>
              </h3>
              <p className="text-[11px] text-emerald-400 font-medium mt-1">Live Attendance Sync</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-card/80 to-amber-500/5 backdrop-blur-md shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active Classrooms</p>
              <h3 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                {CLASSES.length} <span className="text-sm font-normal text-muted-foreground">Classes</span>
              </h3>
              <p className="text-[11px] text-amber-400 font-medium mt-1">Sections A–D Supported</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Layers className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-card/80 to-purple-500/5 backdrop-blur-md shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Faculty & Staff</p>
              <h3 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">{totalTeachers}</h3>
              <p className="text-[11px] text-purple-400 font-medium mt-1">Teaching & Admin</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <GraduationCap className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subheader and Refresh Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Select a Class</h2>
          <p className="text-xs text-muted-foreground">Click any class below to inspect sections and student rosters.</p>
        </div>

        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded-xl border-border/70 text-xs h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Sync Class Data'}
        </Button>
      </div>

      {/* Classes Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {CLASSES.map(cls => {
          const classStr = String(cls);
          const cStats = classStats[classStr] || { total: 0, present: 0, sections: {} };
          const activeSectionsCount = Object.values(cStats.sections).filter(s => s.total > 0).length;

          return (
            <Card 
              key={cls}
              className="cursor-pointer border-border/50 bg-card/60 backdrop-blur-md hover:border-primary/50 hover:shadow-xl transition-all duration-300 rounded-2xl group hover:-translate-y-1 relative overflow-hidden"
              onClick={() => setSelectedClass(cls)}
            >
              <CardContent className="p-6 text-center">
                <div className={`w-16 h-16 ${CLASS_COLORS[cls]} rounded-2xl flex items-center justify-center mx-auto mb-3.5 text-white shadow-lg group-hover:scale-105 transition-transform`}>
                  <span className="font-extrabold text-2xl">{cls}</span>
                </div>
                
                <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">
                  Class {cls}
                </h3>
                
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  <Badge 
                    variant={cStats.total > 0 ? 'secondary' : 'outline'} 
                    className={`font-semibold px-2.5 py-0.5 rounded-lg text-xs ${cStats.total > 0 ? 'bg-primary/10 text-primary border-primary/20' : 'text-muted-foreground'}`}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    {cStats.total} {cStats.total === 1 ? 'student' : 'students'}
                  </Badge>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground flex items-center justify-between">
                  <span>Present Today:</span>
                  <span className={`font-semibold ${cStats.present > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                    {cStats.present} / {cStats.total}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
        
        {/* Teachers & Faculty Card */}
        <Card 
          className="cursor-pointer border-border/50 bg-card/60 backdrop-blur-md hover:border-purple-500/50 hover:shadow-xl transition-all duration-300 rounded-2xl group hover:-translate-y-1 relative overflow-hidden"
          onClick={() => setSelectedCategory('Teacher')}
        >
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-3.5 text-white shadow-lg group-hover:scale-105 transition-transform">
              <GraduationCap className="h-8 w-8" />
            </div>
            
            <h3 className="font-bold text-lg text-foreground group-hover:text-purple-400 transition-colors">
              Teachers & Staff
            </h3>
            
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <Badge 
                variant="secondary" 
                className="font-semibold px-2.5 py-0.5 rounded-lg text-xs bg-purple-500/10 text-purple-400 border-purple-500/20"
              >
                <Users className="h-3 w-3 mr-1" />
                {totalTeachers} {totalTeachers === 1 ? 'teacher' : 'teachers'}
              </Badge>
            </div>

            <div className="mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground flex items-center justify-between">
              <span>Roster:</span>
              <span className="font-semibold text-purple-400">View Faculty</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CategoryBasedView;
