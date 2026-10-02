# ⚡ Presences Spotlight AI — Universal PC Setup & Installation Guide

**Presences Spotlight AI** is an enterprise-grade walk-through face recognition gate terminal engineered for schools and campuses with **2,000+ students**.

This package contains a **1-Click Automated Installer** that works out of the box on **any Windows PC, Laptop, or Smartboard**.

---

## 🚀 1-Click Setup on Any New PC

### Step 1: Copy or Extract the Folder
Copy the `spotlight-gate` folder (or extract `Presences_Spotlight_Gate_Installer.zip`) to anywhere on the target computer (e.g., `C:\Presences\spotlight-gate` or `Desktop`).

### Step 2: Run the Installer
Double-click:
```text
SETUP_ON_ANY_PC.bat
```
*(or `INSTALL_SPOTLIGHT.bat`)*

**What the installer does automatically:**
1. ✅ **Detects / Downloads Python**: Automatically downloads official Python 64-bit silently if not installed.
2. ✅ **Installs All AI Packages**: Installs OpenCV, NumPy, Requests, Pillow, and Pygame without needing Microsoft C++ Build Tools.
3. ✅ **Creates Desktop Shortcut**: Automatically places **"Presences Spotlight Gate"** on the Windows Desktop.
4. ✅ **Opens the Configuration Wizard**: Launches a friendly GUI to test your camera and cloud link.

---

## 🖥️ Graphical Setup Wizard (`installer_gui.py`)

When the GUI wizard opens:
- **Tab 1 (System Diagnostic)**: Confirms all AI vision modules and audio are green and ready.
- **Tab 2 (Camera Ingest)**: Select your USB Webcam (Index 0/1/2) or enter your PoE IP Camera RTSP URL and click **"Test Live Camera Stream"**.
- **Tab 3 (Cloud & Timetable)**: Paste your school's Supabase URL and Key, test the connection, and adjust the morning on-time cutoff time (e.g., `08:30`).
- **Tab 4 (Finish & Launch)**: Click **"Launch Spotlight Gate Terminal Now"** to start the attendance scanner!

---

## 📌 Daily Attendance Operation

Once installed, school staff can start attendance anytime by:
1. **Double-clicking the "Presences Spotlight Gate" icon on the Desktop.**
2. Or running `START_SPOTLIGHT.bat`.
3. To exit the terminal, simply press **`Q`** or **`ESC`** on the keyboard inside the camera window.

---

## 🛠️ File Structure Reference

| File | Purpose |
| :--- | :--- |
| `SETUP_ON_ANY_PC.bat` | Universal 1-Click installer with auto-Python download & configuration |
| `INSTALL_SPOTLIGHT.bat` | Quick alias to run the setup installer |
| `installer_gui.py` | Modern Tkinter Graphical Setup & Configuration Wizard |
| `START_SPOTLIGHT.bat` | 1-Click daily launcher with automatic crash recovery |
| `LAUNCH_SILENT.vbs` | Background launcher for full-screen unattended kiosks |
| `spotlight_engine.py` | Core high-throughput AI gate attendance recognition engine |
| `enrollment_tool.py` | Multi-angle student 3-shot enrollment utility |
| `benchmark_2k.py` | Scalability speed benchmark for 2,000+ student embeddings |
| `PACKAGE_FOR_DISTRIBUTION.bat` | Creates a clean ZIP package ready for USB transfer |
