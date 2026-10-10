import React from 'react';
import {
  User,
  Building2,
  Phone,
  Calendar,
  MapPin,
  Shield,
  Sparkles,
  Users,
  AlertCircle,
  Mail,
  Edit3,
  Lock,
  ShieldCheck
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import DobDatePicker, { calculateAge } from '@/components/enrollment/DobDatePicker';
import type { StudentDetails, StudentField } from '@/services/enrollment/types';
import { resolveIdentityDisplay } from '@/utils/studentIdentityResolver';
import { cn } from '@/lib/utils';

interface EnrollmentInformationCardProps {
  details: StudentDetails;
  editing?: boolean;
  onToggleEditing?: () => void;
  onChangeField: (field: StudentField, value: string) => void;
  disabled?: boolean;
  isPhoneLocked?: boolean;
  canEditPhone?: boolean;
}

export default function EnrollmentInformationCard({
  details,
  onChangeField,
  disabled = false,
  isPhoneLocked = false,
  canEditPhone = false,
}: EnrollmentInformationCardProps) {
  const identity = resolveIdentityDisplay({
    student_name: details.name,
    class: details.class,
    section: details.section,
    category: details.class,
    role: details.role,
  });

  const isTeacher = identity.isTeacher;
  const hasEmailFilled = Boolean(details.email && details.email.trim());

  return (
    <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
      {/* Ambient Top Glow */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white p-1 border border-white/20 flex items-center justify-center shadow-md shadow-emerald-500/10 shrink-0">
            <img src="/kvs-logo.png" alt="Kendriya Vidyalaya Sangathan" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-white">
                Student Profile Details
              </h3>
              <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 bg-blue-500/20 text-blue-300 border-blue-400/40">
                PM Shri KV
              </Badge>
              <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-300 border-emerald-400/40 gap-1 items-center">
                <img src="/logo.png" alt="" className="w-3 h-3 object-contain inline" /> Presences
              </Badge>
              {isTeacher ? (
                <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 bg-purple-500/20 text-purple-300 border-purple-400/40">
                  Faculty
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border-emerald-400/40">
                  Student
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Review and edit any detail directly below before saving
            </p>
          </div>
        </div>

        {/* Modern Live-Editable Chip */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold self-start sm:self-auto shadow-sm">
          <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Click any field to edit</span>
        </div>
      </div>

      {/* Action Required Alert if Email is Missing */}
      {!hasEmailFilled && (
        <div className="mt-4 p-3.5 rounded-2xl bg-amber-500/15 border-2 border-amber-400/60 text-amber-200 text-xs flex items-start sm:items-center gap-3 shadow-lg shadow-amber-500/10">
          <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="font-extrabold text-amber-100 text-xs sm:text-sm flex items-center gap-2">
              <span>Email Address Required</span>
              <Badge variant="outline" className="text-[9px] font-bold px-1.5 py-0 bg-amber-500/25 border-amber-400/60 text-amber-200">
                Required
              </Badge>
            </p>
            <p className="text-[11px] text-amber-200/90 mt-0.5 leading-relaxed">
              Please enter a valid {isTeacher ? 'faculty' : 'student or parent'} email address below for school notifications.
            </p>
          </div>
        </div>
      )}

      {/* Information Grid Sections - Directly Editable */}
      <div className="space-y-4 pt-4">
        {/* Section 1: Core Identity */}
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 block mb-2">
            1. Student Information
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Full Name */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isTeacher ? 'Faculty / Staff Name' : 'Student Full Name'}</span>
              </div>
              <Input
                value={details.name || ''}
                onChange={(e) => onChangeField('name', e.target.value)}
                placeholder="Full name"
                disabled={disabled}
                className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
              />
            </div>

            {/* Admission / Employee ID (Immutable verified identity) */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 transition-all">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{identity.admissionOrEmpLabel}</span>
                </div>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-cyan-500/10 border-cyan-500/30 text-cyan-300">
                  Permanent ID
                </Badge>
              </div>
              <p className="text-sm font-mono font-bold text-emerald-300 py-1">
                {details.admission_number || '—'}
              </p>
            </div>

            {/* Class / Department */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                <Building2 className="w-3.5 h-3.5 text-purple-400" />
                <span>{isTeacher ? 'Designation / Department' : 'Class & Grade'}</span>
              </div>
              {isTeacher ? (
                <p className="text-sm font-bold text-white py-1">
                  {identity.roleLabel}
                </p>
              ) : (
                <Input
                  value={details.class || ''}
                  onChange={(e) => onChangeField('class', e.target.value)}
                  placeholder="e.g. 10 or 8"
                  disabled={disabled}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                />
              )}
            </div>

            {/* Section (Only relevant for students) */}
            {!isTeacher && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span>Section</span>
                </div>
                <Input
                  value={details.section || ''}
                  onChange={(e) => onChangeField('section', e.target.value)}
                  placeholder="e.g. A or B"
                  disabled={disabled}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Contact & Guardian Details */}
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 block mb-2">
            2. {isTeacher ? 'Contact Information' : 'Contact & Guardian Information'}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Phone Number */}
            {(() => {
              const isLockedForCurrentUser = Boolean(isPhoneLocked && !canEditPhone);
              return (
                <div
                  className={cn(
                    "p-3 rounded-2xl transition-all relative",
                    isLockedForCurrentUser
                      ? "bg-amber-500/5 border border-amber-500/30 ring-1 ring-amber-500/10"
                      : "bg-white/[0.03] border border-white/10 hover:border-emerald-500/30"
                  )}
                >
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Phone className={cn("w-3.5 h-3.5", isLockedForCurrentUser ? "text-amber-400" : "text-emerald-400")} />
                      <span>{isTeacher ? 'Registered Mobile Number' : 'Registered Parent Phone'}</span>
                    </div>
                    {isLockedForCurrentUser ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-bold px-1.5 py-0 bg-amber-500/15 border-amber-500/40 text-amber-300 gap-1 flex items-center shadow-sm"
                      >
                        <Lock className="w-2.5 h-2.5 text-amber-400" />
                        Locked · Verified
                      </Badge>
                    ) : isPhoneLocked && canEditPhone ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-bold px-1.5 py-0 bg-emerald-500/15 border-emerald-500/40 text-emerald-300 gap-1 flex items-center shadow-sm"
                      >
                        <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
                        Staff Unlocked
                      </Badge>
                    ) : null}
                  </div>
                  <Input
                    value={details.parent_phone || ''}
                    onChange={(e) => onChangeField('parent_phone', e.target.value)}
                    placeholder="e.g. +91 9876543210"
                    disabled={disabled || isLockedForCurrentUser}
                    readOnly={isLockedForCurrentUser}
                    className={cn(
                      "h-9 text-xs font-semibold rounded-xl",
                      isLockedForCurrentUser
                        ? "bg-slate-950/60 border-amber-500/30 text-slate-300 cursor-not-allowed select-none opacity-90 font-mono"
                        : "bg-slate-950/80 border-white/20 text-white focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                    )}
                  />
                  {isLockedForCurrentUser && (
                    <p className="text-[10px] text-amber-300/80 mt-1.5 flex items-center gap-1 leading-tight">
                      <Lock className="w-2.5 h-2.5 shrink-0 text-amber-400" />
                      <span>Verified school PDF record. Only Enrollment Agent, Teacher, Principal, or Admin can edit phone number.</span>
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Email Address (MANDATORY & REQUIRED) */}
            <div
              className={cn(
                "p-3 rounded-2xl transition-all relative overflow-hidden",
                !hasEmailFilled
                  ? "bg-amber-500/10 border-2 border-amber-400/80 shadow-lg shadow-amber-500/10 ring-2 ring-amber-400/30"
                  : "bg-white/[0.03] border border-white/10 hover:border-emerald-500/30"
              )}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Mail className={cn("w-3.5 h-3.5", !hasEmailFilled ? "text-amber-400 animate-pulse" : "text-sky-400")} />
                  <span className={cn(!hasEmailFilled && "text-amber-200 font-bold")}>
                    {isTeacher ? 'Official / Contact Email' : 'Student or Parent Email'}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] font-extrabold px-1.5 py-0 rounded uppercase tracking-wider",
                    !hasEmailFilled
                      ? "border-amber-400 bg-amber-500/25 text-amber-300 shadow-sm"
                      : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  )}
                >
                  {!hasEmailFilled ? 'Required *' : 'Provided'}
                </Badge>
              </div>

              <div className="space-y-1.5">
                <Input
                  type="email"
                  value={details.email || ''}
                  onChange={(e) => onChangeField('email', e.target.value)}
                  placeholder="e.g. student@school.edu or parent@email.com"
                  disabled={disabled}
                  className={cn(
                    "h-9 bg-slate-950/80 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400",
                    !hasEmailFilled
                      ? "border-amber-400 text-amber-100 placeholder:text-amber-300/40 focus:border-amber-400 focus:ring-amber-400"
                      : "border-white/20"
                  )}
                  required
                />
                {!hasEmailFilled && (
                  <p className="text-[10px] text-amber-300 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Please enter an email before saving.
                  </p>
                )}
              </div>
            </div>

            {/* Date of Birth */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span>Date of Birth</span>
                </div>
                {details.date_of_birth && calculateAge(details.date_of_birth) !== null && (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    {calculateAge(details.date_of_birth)} yrs old
                  </span>
                )}
              </div>
              <DobDatePicker
                value={details.date_of_birth || ''}
                onChange={(val) => onChangeField('date_of_birth', val)}
                compact
                showHelper={false}
                disabled={disabled}
              />
            </div>

            {/* Father's Name (shown for students or if filled) */}
            {(!isTeacher || details.father_name) && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Father’s Name</span>
                </div>
                <Input
                  value={details.father_name || ''}
                  onChange={(e) => onChangeField('father_name', e.target.value)}
                  placeholder="Father's full name"
                  disabled={disabled}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            )}

            {/* Mother's Name (shown for students or if filled) */}
            {(!isTeacher || details.mother_name) && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Mother’s Name</span>
                </div>
                <Input
                  value={details.mother_name || ''}
                  onChange={(e) => onChangeField('mother_name', e.target.value)}
                  placeholder="Mother's full name"
                  disabled={disabled}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Residential Address */}
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 block mb-2">
            3. Residential Address
          </span>
          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-500/30 transition-all">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
              <MapPin className="w-3.5 h-3.5 text-rose-400" />
              <span>Full Address</span>
            </div>
            <textarea
              value={details.address || ''}
              onChange={(e) => onChangeField('address', e.target.value)}
              rows={2}
              placeholder="Residential address details"
              disabled={disabled}
              className="w-full rounded-xl bg-slate-950/80 border border-white/20 p-2.5 text-xs text-white focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 font-medium placeholder:text-slate-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
