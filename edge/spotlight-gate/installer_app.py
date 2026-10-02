"""
Presences Spotlight AI — Native Windows Application Setup Installer
Standalone GUI executable installer that installs Presences Spotlight Gate to the system.
"""

import os
import sys
import time
import shutil
import base64
import zipfile
import threading
import subprocess
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

# Default installation directory
DEFAULT_INSTALL_DIR = str(Path(os.environ.get("LOCALAPPDATA", "C:")) / "Presences" / "SpotlightGate")

# Theme Palette (Slate 900 / Apple Dark Glass)
BG_DARK = "#0f172a"        # Slate 900
BG_CARD = "#1e293b"        # Slate 800
BG_INPUT = "#090d16"       # Slate 950
ACCENT_BLUE = "#3b82f6"    # Blue 500
ACCENT_CYAN = "#06b6d4"    # Cyan 500
ACCENT_GREEN = "#10b981"   # Emerald 500
TEXT_MAIN = "#f8fafc"      # Slate 50
TEXT_MUTED = "#94a3b8"     # Slate 400
BORDER_COLOR = "#334155"   # Slate 700


class ApplicationInstallerGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Presences Spotlight AI — Application Setup Wizard")
        self.root.geometry("640x480")
        self.root.resizable(False, False)
        self.root.configure(bg=BG_DARK)

        self.current_step = 0
        self.install_dir = tk.StringVar(value=DEFAULT_INSTALL_DIR)
        self.create_desktop_shortcut = tk.BooleanVar(value=True)
        self.create_start_menu = tk.BooleanVar(value=True)
        self.launch_after_install = tk.BooleanVar(value=True)

        self.source_dir = Path(__file__).resolve().parent

        self.setup_styles()
        self.build_ui()
        self.show_step(0)

    def setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TProgressbar", thickness=10, troughcolor=BG_CARD,
                        background=ACCENT_CYAN, borderwidth=0)

    def build_ui(self):
        # ── Left Branding Sidebar ──
        self.sidebar = tk.Frame(self.root, bg=BG_CARD, width=180, padx=16, pady=20)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        logo_lbl = tk.Label(self.sidebar, text="⚡", font=("Segoe UI", 32), fg=ACCENT_CYAN, bg=BG_CARD)
        logo_lbl.pack(anchor="w", pady=(10, 0))

        title_lbl = tk.Label(self.sidebar, text="Presences\nSpotlight AI",
                             font=("Segoe UI", 13, "bold"), fg=TEXT_MAIN, bg=BG_CARD, justify="left")
        title_lbl.pack(anchor="w", pady=(4, 16))

        self.step_labels = []
        steps = ["1. Welcome", "2. Location", "3. Shortcuts", "4. Installing", "5. Finished"]
        for s in steps:
            lbl = tk.Label(self.sidebar, text=s, font=("Segoe UI", 9),
                           fg=TEXT_MUTED, bg=BG_CARD, anchor="w")
            lbl.pack(fill="x", pady=4)
            self.step_labels.append(lbl)

        # ── Main Content Area ──
        self.main_container = tk.Frame(self.root, bg=BG_DARK, padx=24, pady=20)
        self.main_container.pack(side="right", fill="both", expand=True)

        self.content_frame = tk.Frame(self.main_container, bg=BG_DARK)
        self.content_frame.pack(fill="both", expand=True)

        # ── Bottom Navigation Bar ──
        nav_frame = tk.Frame(self.main_container, bg=BG_DARK, pady=10)
        nav_frame.pack(fill="x", side="bottom")

        self.btn_back = tk.Button(nav_frame, text="< Back", command=self.go_back,
                                  bg=BG_CARD, fg=TEXT_MAIN, activebackground=BORDER_COLOR,
                                  font=("Segoe UI", 9), padx=14, pady=4, relief="flat", cursor="hand2")
        self.btn_back.pack(side="left")

        self.btn_next = tk.Button(nav_frame, text="Next >", command=self.go_next,
                                  bg=ACCENT_BLUE, fg=TEXT_MAIN, activebackground="#2563eb",
                                  font=("Segoe UI", 9, "bold"), padx=18, pady=4, relief="flat", cursor="hand2")
        self.btn_next.pack(side="right")

        self.btn_cancel = tk.Button(nav_frame, text="Cancel", command=self.root.destroy,
                                    bg=BG_DARK, fg=TEXT_MUTED, activebackground=BG_CARD,
                                    font=("Segoe UI", 9), padx=10, pady=4, relief="flat", cursor="hand2")
        self.btn_cancel.pack(side="right", padx=6)

    def show_step(self, step_idx: int):
        self.current_step = step_idx

        # Update sidebar step indicators
        for i, lbl in enumerate(self.step_labels):
            if i == step_idx:
                lbl.config(fg=ACCENT_CYAN, font=("Segoe UI", 9, "bold"))
            elif i < step_idx:
                lbl.config(fg=ACCENT_GREEN, font=("Segoe UI", 9))
            else:
                lbl.config(fg=TEXT_MUTED, font=("Segoe UI", 9))

        # Clear previous step content
        for child in self.content_frame.winfo_children():
            child.destroy()

        # Render corresponding step view
        if step_idx == 0:
            self.render_welcome_step()
        elif step_idx == 1:
            self.render_location_step()
        elif step_idx == 2:
            self.render_shortcuts_step()
        elif step_idx == 3:
            self.render_installing_step()
        elif step_idx == 4:
            self.render_finish_step()

    # ── Step 0: Welcome ──
    def render_welcome_step(self):
        self.btn_back.config(state="disabled")
        self.btn_next.config(text="Next >", state="normal")

        h_lbl = tk.Label(self.content_frame, text="Welcome to Presences Spotlight Setup",
                         font=("Segoe UI", 14, "bold"), fg=TEXT_MAIN, bg=BG_DARK)
        h_lbl.pack(anchor="w", pady=(0, 10))

        desc = ("This wizard will install Presences Spotlight AI Gate Attendance Terminal "
                "on your computer.\n\n"
                "Key Capabilities included:\n"
                "• Walk-through multi-student face recognition (<1 ms matching)\n"
                "• Automatic anti-false attendance consensus safeguards\n"
                "• Standalone offline SQLite logging with auto-sync to Cloud\n"
                "• Automated parent arrival notification rate limiter\n"
                "• Fullscreen Kiosk HUD & audio confirmation feedback\n\n"
                "Click 'Next' to proceed with installation.")

        lbl_desc = tk.Label(self.content_frame, text=desc, font=("Segoe UI", 9),
                            fg=TEXT_MUTED, bg=BG_DARK, justify="left", wraplength=400)
        lbl_desc.pack(anchor="w", pady=(0, 10))

    # ── Step 1: Location ──
    def render_location_step(self):
        self.btn_back.config(state="normal")
        self.btn_next.config(text="Next >", state="normal")

        h_lbl = tk.Label(self.content_frame, text="Select Installation Destination",
                         font=("Segoe UI", 14, "bold"), fg=TEXT_MAIN, bg=BG_DARK)
        h_lbl.pack(anchor="w", pady=(0, 8))

        desc_lbl = tk.Label(self.content_frame,
                            text="Setup will install the application files into the following folder:",
                            font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_DARK)
        desc_lbl.pack(anchor="w", pady=(0, 12))

        loc_frame = tk.Frame(self.content_frame, bg=BG_DARK)
        loc_frame.pack(fill="x", pady=6)

        ent_dir = tk.Entry(loc_frame, textvariable=self.install_dir, bg=BG_INPUT, fg=TEXT_MAIN,
                           insertbackground=TEXT_MAIN, relief="flat", font=("Segoe UI", 9))
        ent_dir.pack(side="left", fill="x", expand=True, ipady=4, padx=(0, 6))

        btn_browse = tk.Button(loc_frame, text="Browse...", command=self.browse_folder,
                               bg=BG_CARD, fg=TEXT_MAIN, font=("Segoe UI", 8), padx=10, relief="flat", cursor="hand2")
        btn_browse.pack(side="right")

        req_lbl = tk.Label(self.content_frame,
                           text="Required free disk space: ~120 MB\nRecommended permissions: Standard User",
                           font=("Segoe UI", 8), fg=TEXT_MUTED, bg=BG_DARK, justify="left")
        req_lbl.pack(anchor="w", pady=(16, 0))

    def browse_folder(self):
        folder = filedialog.askdirectory(initialdir=self.install_dir.get())
        if folder:
            self.install_dir.set(str(Path(folder) / "SpotlightGate"))

    # ── Step 2: Shortcuts ──
    def render_shortcuts_step(self):
        self.btn_back.config(state="normal")
        self.btn_next.config(text="Install Now", state="normal")

        h_lbl = tk.Label(self.content_frame, text="Select Additional Options",
                         font=("Segoe UI", 14, "bold"), fg=TEXT_MAIN, bg=BG_DARK)
        h_lbl.pack(anchor="w", pady=(0, 10))

        tk.Checkbutton(self.content_frame, text="Create Desktop Shortcut ('Presences Spotlight Gate')",
                       variable=self.create_desktop_shortcut, bg=BG_DARK, fg=TEXT_MAIN,
                       selectcolor=BG_CARD, activebackground=BG_DARK, font=("Segoe UI", 9)).pack(anchor="w", pady=6)

        tk.Checkbutton(self.content_frame, text="Create Windows Start Menu Program Entry",
                       variable=self.create_start_menu, bg=BG_DARK, fg=TEXT_MAIN,
                       selectcolor=BG_CARD, activebackground=BG_DARK, font=("Segoe UI", 9)).pack(anchor="w", pady=6)

        tk.Checkbutton(self.content_frame, text="Launch Configuration Wizard immediately after setup",
                       variable=self.launch_after_install, bg=BG_DARK, fg=TEXT_MAIN,
                       selectcolor=BG_CARD, activebackground=BG_DARK, font=("Segoe UI", 9)).pack(anchor="w", pady=6)

    # ── Step 3: Installing ──
    def render_installing_step(self):
        self.btn_back.config(state="disabled")
        self.btn_next.config(state="disabled")
        self.btn_cancel.config(state="disabled")

        h_lbl = tk.Label(self.content_frame, text="Installing Presences Spotlight AI...",
                         font=("Segoe UI", 14, "bold"), fg=TEXT_MAIN, bg=BG_DARK)
        h_lbl.pack(anchor="w", pady=(0, 10))

        self.install_status_lbl = tk.Label(self.content_frame, text="Preparing installation directory...",
                                           font=("Segoe UI", 9), fg=ACCENT_CYAN, bg=BG_DARK)
        self.install_status_lbl.pack(anchor="w", pady=(0, 6))

        self.prog_bar = ttk.Progressbar(self.content_frame, mode="determinate", style="TProgressbar")
        self.prog_bar.pack(fill="x", pady=6)

        self.install_log = tk.Text(self.content_frame, height=9, bg=BG_INPUT, fg=TEXT_MUTED,
                                   font=("Consolas", 8), relief="flat", padx=8, pady=6)
        self.install_log.pack(fill="both", expand=True, pady=(6, 0))

        threading.Thread(target=self.run_installation_thread, daemon=True).start()

    def run_installation_thread(self):
        target = Path(self.install_dir.get())

        def _log(msg: str):
            self.install_log.insert(tk.END, f"{msg}\n")
            self.install_log.see(tk.END)
            self.install_status_lbl.config(text=msg)

        try:
            # 1. Create Target Directory
            self.prog_bar["value"] = 10
            _log(f"Creating directory: {target}")
            target.mkdir(parents=True, exist_ok=True)
            time.sleep(0.3)

            # 2. Copy Application Files
            self.prog_bar["value"] = 30
            _log("Copying application binaries, scripts, and models...")
            files_to_copy = [
                "spotlight_engine.py",
                "config.py",
                "sound_generator.py",
                "enrollment_tool.py",
                "benchmark_2k.py",
                "installer_gui.py",
                "START_SPOTLIGHT.bat",
                "LAUNCH_SILENT.vbs",
                "SETUP_ON_ANY_PC.bat",
                "INSTALL_DEPENDENCIES.bat",
                "requirements.txt",
                ".env.example",
                "README.md",
                "INSTALLATION_GUIDE.md"
            ]

            for fname in files_to_copy:
                src_file = self.source_dir / fname
                if src_file.exists():
                    shutil.copy2(src_file, target / fname)
                    _log(f"Installed: {fname}")

            # Copy or create .env
            if (self.source_dir / ".env").exists():
                shutil.copy2(self.source_dir / ".env", target / ".env")
            elif (self.source_dir / ".env.example").exists():
                shutil.copy2(self.source_dir / ".env.example", target / ".env")

            self.prog_bar["value"] = 60
            _log("Generating acoustic verification chime...")
            try:
                chime_cmd = [sys.executable, "-c", "from sound_generator import generate_chime; generate_chime('spotlight_chime.wav')"]
                subprocess.run(chime_cmd, cwd=str(target), check=False)
            except Exception:
                pass

            # 3. Create Shortcuts
            self.prog_bar["value"] = 80
            _log("Configuring Windows shortcuts...")

            target_bat = target / "START_SPOTLIGHT.bat"

            if self.create_desktop_shortcut.get():
                desktop_dir = Path(os.environ.get("USERPROFILE", "")) / "Desktop"
                ps_cmd = f"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{desktop_dir / 'Presences Spotlight Gate.lnk'}'); $s.TargetPath = '{target_bat}'; $s.WorkingDirectory = '{target}'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"
                subprocess.run(["powershell", "-Command", ps_cmd], check=False)
                _log("Created Desktop Shortcut: 'Presences Spotlight Gate'")

            if self.create_start_menu.get():
                start_menu = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Presences AI"
                start_menu.mkdir(parents=True, exist_ok=True)
                ps_cmd = f"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{start_menu / 'Presences Spotlight Gate.lnk'}'); $s.TargetPath = '{target_bat}'; $s.WorkingDirectory = '{target}'; $s.Description = 'Presences Spotlight AI Gate Attendance Terminal'; $s.Save()"
                subprocess.run(["powershell", "-Command", ps_cmd], check=False)
                _log("Registered in Windows Start Menu")

            self.prog_bar["value"] = 100
            _log("🎉 Installation completed successfully!")
            time.sleep(0.6)
            self.root.after(0, lambda: self.show_step(4))

        except Exception as err:
            _log(f"Installation Error: {err}")
            messagebox.showerror("Installation Failed", str(err))
            self.btn_cancel.config(state="normal")

    # ── Step 4: Finished ──
    def render_finish_step(self):
        self.btn_back.config(state="disabled")
        self.btn_cancel.config(state="disabled")
        self.btn_next.config(text="Finish", state="normal", bg=ACCENT_GREEN)

        h_lbl = tk.Label(self.content_frame, text="Setup Completed Successfully! 🎉",
                         font=("Segoe UI", 15, "bold"), fg=ACCENT_GREEN, bg=BG_DARK)
        h_lbl.pack(anchor="w", pady=(0, 10))

        desc = ("Presences Spotlight AI has been installed on this computer.\n\n"
                f"Installed to: {self.install_dir.get()}\n\n"
                "You can launch the attendance scanner anytime from your Desktop shortcut "
                "or from the Start Menu.\n\n"
                "Click 'Finish' to complete setup.")

        lbl_desc = tk.Label(self.content_frame, text=desc, font=("Segoe UI", 9),
                            fg=TEXT_MAIN, bg=BG_DARK, justify="left", wraplength=400)
        lbl_desc.pack(anchor="w", pady=(0, 10))

    def go_next(self):
        if self.current_step < 2:
            self.show_step(self.current_step + 1)
        elif self.current_step == 2:
            self.show_step(3)
        elif self.current_step == 4:
            # Finish action
            if self.launch_after_install.get():
                target_gui = Path(self.install_dir.get()) / "installer_gui.py"
                try:
                    subprocess.Popen([sys.executable, str(target_gui)], cwd=str(target_gui.parent))
                except Exception:
                    pass
            self.root.destroy()

    def go_back(self):
        if self.current_step > 0:
            self.show_step(self.current_step - 1)


def main():
    root = tk.Tk()
    app = ApplicationInstallerGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
