import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FolderInput, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CLASSES, SECTIONS, getCategoryLabel } from '@/constants/schoolConfig';
import { universalUpdateStudentClassSection } from '@/services/student/studentUpdateService';

interface ChangeCategoryDialogProps {
  userId?: string;
  employeeId?: string;
  studentId?: string;
  userName: string;
  currentCategory: string;
  onCategoryChanged?: () => void;
  trigger?: React.ReactNode;
}

const ChangeCategoryDialog: React.FC<ChangeCategoryDialogProps> = ({
  userId,
  employeeId,
  studentId,
  userName,
  currentCategory,
  onCategoryChanged,
  trigger,
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isTeacher, setIsTeacher] = useState(currentCategory === 'Teacher');
  const [selectedClass, setSelectedClass] = useState(() => {
    const match = currentCategory.match(/^(\d+)-/);
    return match ? match[1] : '6';
  });
  const [selectedSection, setSelectedSection] = useState(() => {
    const match = currentCategory.match(/-([A-D])$/);
    return match ? match[1] : 'A';
  });
  const [isUpdating, setIsUpdating] = useState(false);

  const newCategory = isTeacher ? 'Teacher' : `${selectedClass}-${selectedSection}`;

  const handleUpdate = async () => {
    if (newCategory === currentCategory) {
      setOpen(false);
      return;
    }
    setIsUpdating(true);
    try {
      const target = {
        id: studentId || userId,
        user_id: userId,
        employee_id: employeeId,
        admission_number: employeeId,
        name: userName,
      };

      await universalUpdateStudentClassSection(target, {
        class: isTeacher ? 'Teacher' : selectedClass,
        section: isTeacher ? '' : selectedSection,
        category: newCategory,
        role: isTeacher ? 'teacher' : 'student',
      });

      toast({
        title: 'Class & Section Updated',
        description: `${userName} successfully moved to ${getCategoryLabel(newCategory)}`,
      });
      onCategoryChanged?.();
      setOpen(false);
    } catch (error: any) {
      console.error('Error updating category:', error);
      toast({
        title: 'Update Failed',
        description: error?.message || 'Failed to update student class/section.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs">
            <FolderInput className="h-3.5 w-3.5" />
            Class / Sec
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Class / Section</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Student</Label>
            <p className="font-semibold text-sm">{userName}</p>
            {employeeId && employeeId !== '—' && (
              <p className="text-xs text-muted-foreground font-mono">ID / Adm: {employeeId}</p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Current Assignment</Label>
            <p className="font-medium text-xs bg-muted px-2 py-1 rounded inline-block mt-0.5">
              {getCategoryLabel(currentCategory)}
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isTeacher}
              onChange={(e) => setIsTeacher(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs font-medium">Designate as Teacher / Staff</span>
          </label>

          {!isTeacher && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <Label className="text-xs">Class</Label>
                <Select value={selectedClass} onValueChange={setSelectedClass}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSES.map((cls) => (
                      <SelectItem key={cls} value={String(cls)} className="text-xs">
                        Class {cls}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Section</Label>
                <Select value={selectedSection} onValueChange={setSelectedSection}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTIONS.map((sec) => (
                      <SelectItem key={sec} value={sec} className="text-xs">
                        Section {sec}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpdate}
              disabled={isUpdating || newCategory === currentCategory}
              className="gap-1.5"
            >
              {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeCategoryDialog;
