import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  GraduationCap,
  Building2,
  Phone,
  Calendar,
  MapPin,
  Edit3,
  Check,
  Shield,
  Sparkles,
  Users,
  AlertCircle
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DobDatePicker, { calculateAge } from '@/components/enrollment/DobDatePicker';
import type { StudentDetails, StudentField } from '@/services/enrollment/types';
import { resolveIdentityDisplay } from '@/utils/studentIdentityResolver';

interface EnrollmentInformationCardProps {
  details: StudentDetails;
  editing: boolean;
  onToggleEditing: () => void;
  onChangeField: (field: StudentField, value: string) => void;
  disabled?: boolean;
}

export default function EnrollmentInformationCard({
  details,
  editing,
  onToggleEditing,
  onChangeField,
  disabled = false,
}: EnrollmentInformationCardProps) {
  const identity = resolveIdentityDisplay({
    student_name: details.name,
    class: details.class,
    section: details.section,
    category: details.class,
    role: (details as any).role,
  });

  const isTeacher = identity.isTeacher;

  return (
    <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 p-5 sm:p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
      {/* Ambient Top Glow */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-500/10">
            {isTeacher ? <Shield className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-white">
                Official Information Record
              </h3>
              {isTeacher ? (
                <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 bg-purple-500/20 text-purple-300 border-purple-400/40">
                  ★ Faculty
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border-emerald-400/40">
                  Student
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Verified identity details linked to campus records
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onToggleEditing}
          className={`h-9 px-3.5 rounded-xl text-xs font-bold gap-1.5 transition-all self-start sm:self-auto ${
            editing
              ? 'bg-emerald-500 text-slate-950 border-emerald-400 hover:bg-emerald-400'
              : 'border-white/15 bg-white/5 hover:bg-white/10 text-slate-200'
          }`}
        >
          {editing ? (
            <>
              <Check className="w-3.5 h-3.5 stroke-[3]" /> Done Editing
            </>
          ) : (
            <>
              <Edit3 className="w-3.5 h-3.5 text-emerald-400" /> Request Corrections
            </>
          )}
        </Button>
      </div>

      {/* Information Grid Sections */}
      <div className="space-y-4 pt-4">
        {/* Section 1: Core Identity */}
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 block mb-2">
            1. Core Identity
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Full Name */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isTeacher ? 'Faculty / Staff Name' : 'Student Full Name'}</span>
              </div>
              {editing ? (
                <Input
                  value={details.name}
                  onChange={(e) => onChangeField('name', e.target.value)}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                />
              ) : (
                <p className="text-sm font-bold text-white truncate">
                  {details.name || '—'}
                </p>
              )}
            </div>

            {/* Admission / Employee ID */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span>{identity.admissionOrEmpLabel}</span>
              </div>
              <p className="text-sm font-mono font-bold text-emerald-300">
                {details.admission_number || '—'}
              </p>
            </div>

            {/* Class / Department */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                <Building2 className="w-3.5 h-3.5 text-purple-400" />
                <span>{isTeacher ? 'Designation / Department' : 'Class & Grade'}</span>
              </div>
              {editing && !isTeacher ? (
                <Input
                  value={details.class}
                  onChange={(e) => onChangeField('class', e.target.value)}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                />
              ) : (
                <p className="text-sm font-bold text-white">
                  {isTeacher ? identity.roleLabel : details.class ? `Class ${details.class}` : '—'}
                </p>
              )}
            </div>

            {/* Section (Only relevant for students) */}
            {!isTeacher && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span>Section</span>
                </div>
                {editing ? (
                  <Input
                    value={details.section}
                    onChange={(e) => onChangeField('section', e.target.value)}
                    className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                  />
                ) : (
                  <p className="text-sm font-bold text-white">
                    {details.section ? `Section ${details.section}` : '—'}
                  </p>
                )}
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
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isTeacher ? 'Registered Mobile Number' : 'Registered Parent Phone'}</span>
              </div>
              {editing ? (
                <Input
                  value={details.parent_phone}
                  onChange={(e) => onChangeField('parent_phone', e.target.value)}
                  className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                />
              ) : (
                <p className="text-sm font-mono font-bold text-white">
                  {details.parent_phone || '— Not provided'}
                </p>
              )}
            </div>

            {/* Date of Birth */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span>Date of Birth</span>
                </div>
                {!editing && details.date_of_birth && calculateAge(details.date_of_birth) !== null && (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    {calculateAge(details.date_of_birth)} yrs old
                  </span>
                )}
              </div>
              {editing ? (
                <DobDatePicker
                  value={details.date_of_birth || ''}
                  onChange={(val) => onChangeField('date_of_birth', val)}
                  compact
                  showHelper={false}
                  disabled={disabled}
                />
              ) : (
                <p className="text-sm font-bold text-white font-mono">
                  {details.date_of_birth || <span className="text-slate-500 font-sans italic font-normal text-xs">— Not provided</span>}
                </p>
              )}
            </div>

            {/* Father's Name (shown for students or if filled) */}
            {(!isTeacher || details.father_name) && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Father’s Name</span>
                </div>
                {editing ? (
                  <Input
                    value={details.father_name}
                    onChange={(e) => onChangeField('father_name', e.target.value)}
                    className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                  />
                ) : (
                  <p className="text-sm font-semibold text-slate-200">
                    {details.father_name || '— Not provided'}
                  </p>
                )}
              </div>
            )}

            {/* Mother's Name (shown for students or if filled) */}
            {(!isTeacher || details.mother_name) && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Mother’s Name</span>
                </div>
                {editing ? (
                  <Input
                    value={details.mother_name}
                    onChange={(e) => onChangeField('mother_name', e.target.value)}
                    className="h-9 bg-slate-950/80 border-white/20 text-white text-xs font-semibold rounded-xl focus:ring-emerald-400"
                  />
                ) : (
                  <p className="text-sm font-semibold text-slate-200">
                    {details.mother_name || '— Not provided'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Residential Address */}
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 block mb-2">
            3. Residential Address
          </span>
          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
              <MapPin className="w-3.5 h-3.5 text-rose-400" />
              <span>Full Address</span>
            </div>
            {editing ? (
              <textarea
                value={details.address}
                onChange={(e) => onChangeField('address', e.target.value)}
                rows={2}
                className="w-full rounded-xl bg-slate-950/80 border border-white/20 p-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 font-medium"
              />
            ) : (
              <p className="text-xs sm:text-sm font-medium text-slate-200 leading-relaxed break-words">
                {details.address || '— Not provided'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
