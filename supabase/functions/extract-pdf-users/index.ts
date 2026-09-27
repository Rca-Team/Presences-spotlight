import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Robust multi-strategy parser that handles clean JSON, truncated JSON,
 * trailing commas, missing outer brackets, and raw embedded objects.
 */
function parseGeminiResponse(rawText: string): { users: any[]; class_detected?: string } {
  if (!rawText || typeof rawText !== "string") {
    return { users: [] };
  }

  let text = rawText.trim();
  // Strip markdown code fences
  if (text.startsWith("```json")) text = text.slice(7);
  else if (text.startsWith("```")) text = text.slice(3);
  if (text.endsWith("```")) text = text.slice(0, -3);
  text = text.trim();

  // Strategy 1: Direct JSON.parse
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return { users: direct };
    if (Array.isArray(direct?.users)) return { users: direct.users, class_detected: direct.class_detected };
  } catch {}

  // Strategy 2: Extract top-level JSON object or array substring
  try {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.users)) {
        return { users: parsed.users, class_detected: parsed.class_detected };
      }
    }
  } catch {}

  // Strategy 3: Handle truncated array/object (repair unclosed brackets)
  try {
    const usersIdx = text.indexOf('"users"');
    if (usersIdx !== -1) {
      const arrayStart = text.indexOf('[', usersIdx);
      if (arrayStart !== -1) {
        let sub = text.slice(arrayStart);
        // Find last complete object closing '}'
        const lastObjEnd = sub.lastIndexOf('}');
        if (lastObjEnd !== -1) {
          sub = sub.slice(0, lastObjEnd + 1) + ']';
          // Clean trailing commas before ']'
          sub = sub.replace(/,\s*\]/g, ']');
          const parsedUsers = JSON.parse(sub);
          if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
            return { users: parsedUsers };
          }
        }
      }
    }
  } catch {}

  // Strategy 4: Regex-based individual student object extractor
  // Matches each { ... } block that contains student fields
  const recovered: any[] = [];
  const objectRegex = /\{[^{}]*?(?:"name"|"employee_id"|"student_name"|"admn_no")[^{}]*?\}/g;
  let match;
  while ((match = objectRegex.exec(text)) !== null) {
    try {
      const sanitized = match[0].replace(/[\u0000-\u001F]+/g, " ");
      const student = JSON.parse(sanitized);
      if (student.name || student.employee_id || student.student_name) {
        recovered.push(student);
      }
    } catch {}
  }

  if (recovered.length > 0) {
    return { users: recovered };
  }

  // Strategy 5: Block boundary splitting
  const blocks = text.split(/(?<=\})\s*,\s*(?=\{)/);
  for (const b of blocks) {
    try {
      const cleanedBlock = b.trim().replace(/^\[\s*/, '').replace(/\s*\]$/, '');
      if (cleanedBlock.startsWith('{') && cleanedBlock.endsWith('}')) {
        const item = JSON.parse(cleanedBlock);
        if (item.name || item.employee_id) {
          recovered.push(item);
        }
      }
    } catch {}
  }

  return { users: recovered };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in as a teacher or admin.", users: [] }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Invalid user session.", users: [] }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Role check: Only admin, principal, or teacher can use whole-class PDF extraction
    const { data: roleRows } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const rolesList = (roleRows || []).map((r: any) => r.role);
    const isAdminOrPrincipal = rolesList.includes("admin") || rolesList.includes("principal") || (user.email && user.email.toLowerCase().includes("admin"));
    let isTeacher = rolesList.includes("teacher");

    // Also check class_teachers and teacher_permissions tables
    let teacherAllowedClasses: string[] = [];
    const { data: classRows } = await serviceClient
      .from("class_teachers")
      .select("category, class, section")
      .eq("teacher_id", user.id);

    const { data: permRows } = await serviceClient
      .from("teacher_permissions")
      .select("category, class, section")
      .or(`user_id.eq.${user.id},teacher_id.eq.${user.id}`);

    const allowedSet = new Set<string>();
    (classRows || []).forEach((r: any) => {
      if (r.category) allowedSet.add(r.category.trim().toUpperCase());
      if (r.class && r.section) allowedSet.add(`${r.class}-${r.section}`.trim().toUpperCase());
    });
    (permRows || []).forEach((r: any) => {
      if (r.category) allowedSet.add(r.category.trim().toUpperCase());
      if (r.class && r.section) allowedSet.add(`${r.class}-${r.section}`.trim().toUpperCase());
    });

    if (allowedSet.size > 0) {
      isTeacher = true;
      teacherAllowedClasses = Array.from(allowedSet);
      console.log(`Teacher ${user.id} authorized classes:`, teacherAllowedClasses);
    }

    if (!isAdminOrPrincipal && !isTeacher) {
      return new Response(
        JSON.stringify({ error: "Forbidden. Only teachers and administrators can import ID card PDFs.", users: [] }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { fileData, fileName, fileType, targetCategory } = await req.json();

    if (!fileData) {
      return new Response(
        JSON.stringify({ error: "No file data provided", users: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If teacher provided a targetCategory, verify they are assigned to it
    if (isTeacher && !isAdminOrPrincipal && targetCategory) {
      const normTarget = targetCategory.trim().toUpperCase();
      const hasAccess = teacherAllowedClasses.some(c => c === normTarget || c.replace(/\s+/g, '') === normTarget.replace(/\s+/g, ''));
      if (!hasAccess && teacherAllowedClasses.length > 0) {
        return new Response(
          JSON.stringify({ 
            error: `You are only authorized to import ID cards for your assigned class (${teacherAllowedClasses.join(', ')}).`, 
            users: [] 
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY secret not configured in Supabase. Please contact administrator.", users: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ID card file: ${fileName}, type: ${fileType}, data length: ${fileData?.length || 0}`);

    // Parse base64 and mime type
    let mimeType = fileType || "application/pdf";
    let base64Content = fileData;
    if (fileData.includes(",")) {
      const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Content = match[2];
      } else {
        base64Content = fileData.split(",")[1];
      }
    }

    const isPdf = mimeType.toLowerCase().includes("pdf") || (fileName && fileName.toLowerCase().endsWith(".pdf"));
    if (isPdf) mimeType = "application/pdf";

    // High-efficiency concise system prompt for Kendriya Vidyalaya (PM SHRI KV) ID cards
    const systemPrompt = `You are an expert AI extractor for PM SHRI KENDRIYA VIDYALAYA (KV) student identity cards.
Extract every student ID card found across all pages in this document into clean JSON.

Card Layout details:
- Top Banner Header: Kendriya Vidyalaya branch name
- Student ID: 10-digit number (e.g. "1000481387")
- Student Name: Bold uppercase text under photo (e.g. "AISHA ALVI")
- Admn No: Admission number (e.g. "12453") -> Use as employee_id
- Class: class and section (e.g. "6 A" -> format as "6-A")
- Father/Mother Name: Father & Mother names
- Phone: 10-digit phone number
- DOB: DD-MM-YYYY
- PEN No: Permanent Education Number
- Blood Group, Address: if visible

Output JSON format:
{
  "class_detected": "6-A",
  "users": [
    {
      "name": "STUDENT NAME",
      "employee_id": "ADMISSION_NUMBER",
      "student_id_kv": "1000481387",
      "class": "6",
      "section": "A",
      "department": "6-A",
      "father_name": "FATHER NAME",
      "mother_name": "MOTHER NAME",
      "parent_phone": "9818115518",
      "date_of_birth": "26-08-2014",
      "pen_number": "20432877236",
      "blood_group": "B+",
      "address": "Address string"
    }
  ]
}`;

    const buildPayload = (useCamelCase = false) => ({
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\nPlease analyze this document ("${fileName}") and extract all student ID cards across all pages into the JSON format above.`
            },
            useCamelCase ? {
              inlineData: {
                mimeType: mimeType,
                data: base64Content
              }
            } : {
              inline_data: {
                mime_type: mimeType,
                data: base64Content
              }
            }
          ]
        }
      ],
      generationConfig: useCamelCase ? {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 32768
      } : {
        response_mime_type: "application/json",
        temperature: 0.1,
        max_output_tokens: 32768
      }
    });

    // Dynamic model discovery with priority for 2.0-flash and 1.5-flash
    let candidateModels: { version: string; name: string }[] = [];
    try {
      console.log("Querying Gemini ListModels for supported models...");
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
      if (listResp.ok) {
        const listData = await listResp.json();
        const discovered = (listData.models || [])
          .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
          .map((m: any) => m.name.replace(/^models\//, ""));

        console.log(`Discovered ${discovered.length} supported models`);

        const usable = discovered.filter((m: string) => !m.includes("embedding") && !m.includes("aqa"));
        usable.sort((a: string, b: string) => {
          if (a.includes("2.0-flash") && !b.includes("2.0-flash")) return -1;
          if (!a.includes("2.0-flash") && b.includes("2.0-flash")) return 1;
          if (a.includes("flash") && !b.includes("flash")) return -1;
          if (!a.includes("flash") && b.includes("flash")) return 1;
          return 0;
        });

        usable.forEach((m: string) => candidateModels.push({ version: "v1beta", name: m }));
      }
    } catch (e: any) {
      console.warn("ListModels query error:", e.message);
    }

    if (candidateModels.length === 0) {
      candidateModels = [
        { version: "v1beta", name: "gemini-2.0-flash" },
        { version: "v1beta", name: "gemini-2.0-flash-exp" },
        { version: "v1beta", name: "gemini-1.5-flash-latest" },
        { version: "v1", name: "gemini-1.5-flash" },
        { version: "v1beta", name: "gemini-1.5-pro-latest" },
      ];
    }

    let rawAiText = "";
    const attemptErrors: string[] = [];

    // Try candidate models
    for (const item of candidateModels) {
      for (const useCamel of [false, true]) {
        try {
          console.log(`Trying Gemini model ${item.name} (${item.version}, camelCase=${useCamel}) for ${fileName}...`);
          const geminiUrl = `https://generativelanguage.googleapis.com/${item.version}/models/${item.name}:generateContent?key=${GEMINI_API_KEY}`;
          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPayload(useCamel)),
          });

          if (response.ok) {
            const geminiResult = await response.json();
            rawAiText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (rawAiText) {
              console.log(`Successfully extracted with ${item.name}! Length: ${rawAiText.length}`);
              break;
            }
          } else {
            const errText = await response.text();
            attemptErrors.push(`${item.name} (${item.version}) [HTTP ${response.status}]: ${errText.slice(0, 150)}`);
          }
        } catch (err: any) {
          attemptErrors.push(`${item.name} error: ${err.message}`);
        }
      }
      if (rawAiText) break;
    }

    if (!rawAiText) {
      return new Response(
        JSON.stringify({ 
          error: `AI processing failed across available models. Details: ${attemptErrors.slice(0, 3).join(' | ')}`, 
          users: [] 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse extracted JSON with bulletproof multi-strategy parser
    const parsedData = parseGeminiResponse(rawAiText);
    let users = Array.isArray(parsedData.users) ? parsedData.users : [];

    if (users.length === 0) {
      console.warn("No students could be parsed from output. Raw preview:", rawAiText.slice(0, 400));
      return new Response(
        JSON.stringify({
          error: "Could not parse student cards from this document. Please ensure the PDF is clear and contains readable ID cards.",
          rawPreview: rawAiText.slice(0, 300),
          users: []
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean and normalize each student record
    users = users.map((u: any, index: number) => {
      let cls = String(u.class || "").replace(/[^0-9]/g, "");
      let sec = String(u.section || "").trim().toUpperCase();
      let dept = u.department || (cls && sec ? `${cls}-${sec}` : "");

      if (!cls && dept) {
        const m = dept.match(/^(\d+)\s*[-_\s]\s*([A-Da-d])$/);
        if (m) {
          cls = m[1];
          sec = m[2].toUpperCase();
          dept = `${cls}-${sec}`;
        }
      }

      if ((!cls || !sec) && targetCategory) {
        const tm = targetCategory.match(/^(\d+)\s*-\s*([A-Da-d])$/);
        if (tm) {
          cls = cls || tm[1];
          sec = sec || tm[2].toUpperCase();
          dept = `${cls}-${sec}`;
        }
      }

      return {
        name: u.name || `Student ${index + 1}`,
        employee_id: String(u.employee_id || u.admission_no || u.admn_no || `STU-${Date.now()}-${index + 1}`).trim(),
        student_id_kv: u.student_id_kv || "",
        class: cls,
        section: sec,
        department: dept || `${cls || "6"}-${sec || "A"}`,
        roll_number: String(u.roll_number || "").trim(),
        position: "Student",
        father_name: u.father_name || "",
        mother_name: u.mother_name || "",
        parent_name: u.parent_name || u.father_name || u.mother_name || "Parent / Guardian",
        parent_phone: String(u.parent_phone || u.phone || "").replace(/\D/g, "").slice(-10),
        parent_email: u.parent_email || "",
        student_email: u.email || u.student_email || "",
        phone: u.student_phone || "",
        blood_group: u.blood_group || "",
        date_of_birth: u.date_of_birth || "",
        pen_number: u.pen_number || "",
        address: u.address || "",
        barcode: u.barcode || "",
        has_photo: !!u.has_photo,
        photo_bbox: u.photo_bbox || null,
      };
    });

    // If teacher is constrained to specific classes, filter out students from other classes
    if (isTeacher && !isAdminOrPrincipal && teacherAllowedClasses.length > 0) {
      const originalCount = users.length;
      users = users.filter((u: any) => {
        const uCat = (u.department || `${u.class}-${u.section}`).toUpperCase();
        return teacherAllowedClasses.some(allowed => allowed === uCat || allowed.replace(/\s+/g, '') === uCat.replace(/\s+/g, ''));
      });
      console.log(`Filtered for teacher: ${users.length} of ${originalCount} matched assigned classes: ${teacherAllowedClasses.join(", ")}`);
    }

    console.log(`Successfully extracted and normalized ${users.length} students from ID cards`);

    return new Response(
      JSON.stringify({
        total_extracted: users.length,
        class_detected: parsedData.class_detected || users[0]?.department || targetCategory || "",
        users,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("extract-pdf-users exception:", errorMsg);
    return new Response(
      JSON.stringify({ error: errorMsg, users: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
