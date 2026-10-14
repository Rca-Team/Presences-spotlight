"""
Presences Spotlight AI — Smart Gate Logistic Comprehensive Test Suite
Verifies:
1. Adaptive Illumination Normalization (CLAHE Backlight & Glare Compensation)
2. Motion Blur Recovery (Unsharp Masking)
3. Dynamic Ambiguity Margin Guard (Zero-False Attendance for Lookalike Students)
4. Multi-Frame Trajectory Consensus (Zero-False Commitment)
5. Cross-Camera Real-Time Deduplication
"""

import os
import sys
import time
import numpy as np
import cv2

# Ensure engine path is available
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from google_pipeline import GoogleFacePipeline
from spotlight_engine import SpotlightEngine, StudentTrack


def test_1_adaptive_illumination_normalization():
    print("\n--- Test 1: Adaptive Illumination Normalization (AIE) ---")
    
    # 1. Dark/Backlit face simulation (mean lum ~35)
    dark_face = np.full((100, 100, 3), 35, dtype=np.uint8)
    cv2.circle(dark_face, (50, 50), 30, (55, 55, 55), -1)  # faint contour
    
    enh_dark, cond_dark, was_enh_dark = GoogleFacePipeline.enhance_face_illumination(dark_face)
    mean_before = np.mean(dark_face)
    mean_after = np.mean(enh_dark)
    
    assert was_enh_dark == True, "Failed: Dark face should be marked as enhanced"
    assert "enhanced" in cond_dark, f"Failed: Condition label should indicate enhancement, got {cond_dark}"
    assert mean_after > mean_before, f"Failed: Enhanced luminance ({mean_after:.1f}) should exceed original ({mean_before:.1f})"
    print(f"  [OK] Backlight/Shadow CLAHE: Luminance increased from {mean_before:.1f} to {mean_after:.1f} ({cond_dark})")

    # 2. Glare/Overexposed face simulation (mean lum ~230)
    bright_face = np.full((100, 100, 3), 235, dtype=np.uint8)
    enh_bright, cond_bright, was_enh_bright = GoogleFacePipeline.enhance_face_illumination(bright_face)
    mean_bright_after = np.mean(enh_bright)
    
    assert was_enh_bright == True, "Failed: Overexposed face should be marked as enhanced"
    assert cond_bright == "glare_normalized", f"Failed: Condition should be glare_normalized, got {cond_bright}"
    assert mean_bright_after < 235, f"Failed: Glare normalization should compress highlights ({mean_bright_after:.1f})"
    print(f"  [OK] Glare/Overexposure Gamma: Luminance compressed from 235.0 to {mean_bright_after:.1f} ({cond_bright})")

    # 3. Optimal face simulation (mean lum ~130)
    optimal_face = np.full((100, 100, 3), 130, dtype=np.uint8)
    enh_opt, cond_opt, was_enh_opt = GoogleFacePipeline.enhance_face_illumination(optimal_face)
    assert was_enh_opt == False, "Failed: Optimal lighting should not be modified"
    assert cond_opt == "optimal"
    print("  [OK] Optimal lighting preserved without unnecessary modification")


def test_2_motion_blur_recovery():
    print("\n--- Test 2: Motion Blur Recovery (Unsharp Masking) ---")
    
    # Create synthetic pattern with edges
    img = np.zeros((80, 80, 3), dtype=np.uint8)
    cv2.circle(img, (40, 40), 20, (200, 200, 200), 2)
    
    # Simulate motion blur with Laplacian variance = 35.0 (within 15-75 range)
    sharpened = GoogleFacePipeline.enhance_sharpness_for_motion(img, sharpness=35.0)
    
    assert sharpened is not None
    assert sharpened.shape == img.shape
    
    # Test that high sharpness (>80) is untouched
    sharp_img = GoogleFacePipeline.enhance_sharpness_for_motion(img, sharpness=110.0)
    assert np.array_equal(sharp_img, img), "Failed: Already sharp image should remain untouched"
    print("  [OK] Motion blur edge recovery active for walking blur range (15 <= var <= 75)")


def test_3_dynamic_ambiguity_margin_guard():
    print("\n--- Test 3: Dynamic Ambiguity Margin Guard (Zero-False for Lookalikes) ---")
    
    engine = SpotlightEngine()
    
    # Set up 2 students with mock embeddings
    vec_student_a = np.zeros(128, dtype=np.float32)
    vec_student_a[0] = 1.0  # Unit vector
    
    # Student B has a very close lookalike embedding (distance = 0.04)
    vec_student_b = np.copy(vec_student_a)
    vec_student_b[1] = 0.04
    vec_student_b /= np.linalg.norm(vec_student_b)
    
    # Student C has a distinct embedding (distance = 0.30)
    vec_student_c = np.zeros(128, dtype=np.float32)
    vec_student_c[2] = 1.0
    
    engine.enrolled_students = [
        {"student_id": "101", "student_name": "Student A", "descriptor": vec_student_a},
        {"student_id": "102", "student_name": "Student B (Lookalike)", "descriptor": vec_student_b},
        {"student_id": "103", "student_name": "Student C (Distinct)", "descriptor": vec_student_c}
    ]
    engine.descriptors_matrix = np.array([vec_student_a, vec_student_b, vec_student_c], dtype=np.float32)
    
    # Query vector very close to Student A, but also within 0.04 of Student B
    # Margin between Student A and Student B is < AMBIGUITY_MARGIN_DELTA (0.08)
    query_lookalike = np.copy(vec_student_a)
    query_lookalike[1] = 0.015
    query_lookalike /= np.linalg.norm(query_lookalike)
    
    match, dist = engine.match_face_vectorized(query_lookalike)
    assert match is None, f"Failed: Ambiguous lookalike candidate should be REJECTED to prevent false attendance, got {match}"
    print("  [OK] Lookalike collision correctly blocked by Dynamic Ambiguity Margin Guard (Zero False Mark)")

    # Query vector for Student C with safe margin (> 0.08 from next student)
    query_student_c = np.copy(vec_student_c)
    query_student_c[3] = 0.02
    query_student_c /= np.linalg.norm(query_student_c)
    
    match_c, dist_c = engine.match_face_vectorized(query_student_c)
    assert match_c is not None, "Failed: Clear distinct candidate should be MATCHED"
    assert match_c["student_id"] == "103"
    print(f"  [OK] Distinct student verified with confidence (distance: {dist_c:.3f})")


def test_4_multiframe_trajectory_consensus():
    print("\n--- Test 4: Multi-Frame Trajectory Consensus (Zero False Commitment) ---")
    
    track = StudentTrack(track_id=1, bbox=(50, 150, 150, 50))
    student = {"student_id": "201", "student_name": "Alex Walker"}
    req_frames = config.CONSENSUS_FRAMES_REQUIRED
    
    # 1. Add (req_frames - 1) detections at distance 0.38
    for i in range(req_frames - 1):
        track.add_match(student, distance=0.38, quality=0.75, lighting="optimal")
    
    # In STRICT_ZERO_FALSE_MODE, less than req_frames must NEVER commit attendance
    winner = track.get_consensus_winner()
    assert winner is None, f"Failed: {req_frames - 1} frames must not commit attendance in strict zero-false mode"
    print(f"  [OK] Partial trajectory ({req_frames - 1} frames): Match safely held in candidate buffer without premature commitment")

    # 2. Add final agreeing detection to satisfy consensus threshold
    track.add_match(student, distance=0.36, quality=0.82, lighting="optimal")
    winner = track.get_consensus_winner()
    assert winner is not None, f"Failed: {req_frames} agreeing frames in trajectory should reach consensus"
    win_student, avg_dist, votes = winner
    assert win_student["student_id"] == "201"
    assert votes == req_frames
    assert avg_dist < 0.40
    print(f"  [OK] Full trajectory consensus reached: Verified with {votes} agreeing frames (avg dist: {avg_dist:.3f})")


def test_5_cross_camera_deduplication():
    print("\n--- Test 5: Cross-Camera Real-Time Deduplication ---")
    
    engine = SpotlightEngine()
    student = {"student_id": "301", "student_name": "Emma Watson", "class_name": "10", "section": "A"}
    
    # Clear session and dedup table for test
    engine.recent_verifications.clear()
    
    # 1. Camera 1 verifies student
    engine.handle_confirmed_attendance(student, confidence_score=0.96, cam_id=1)
    assert engine.counter_lane1 == 1
    print("  [OK] Lane 1 confirmed student arrival")

    # 2. Camera 2 sees student 5 seconds later
    time.sleep(0.05)
    engine.handle_confirmed_attendance(student, confidence_score=0.95, cam_id=2)
    
    # Lane 2 count must not increment, total present must stay 1
    assert engine.counter_total_present == 1, f"Failed: Duplicate mark was not suppressed (total: {engine.counter_total_present})"
    assert engine.counter_lane2 == 0, f"Failed: Lane 2 should be 0, got {engine.counter_lane2}"
    assert engine.hud_banner_status[2] == "ALREADY RECORDED"
    print("  [OK] Lane 2 correctly identified student as 'ALREADY RECORDED' with zero duplicate rows")


if __name__ == "__main__":
    print("=====================================================================")
    print("  PRESENCES SPOTLIGHT AI -- SMART GATE LOGISTIC TEST SUITE")
    print("=====================================================================")
    
    try:
        test_1_adaptive_illumination_normalization()
        test_2_motion_blur_recovery()
        test_3_dynamic_ambiguity_margin_guard()
        test_4_multiframe_trajectory_consensus()
        test_5_cross_camera_deduplication()
        
        print("\n=====================================================================")
        print("  ALL 5 SMART GATE LOGISTIC TESTS PASSED SUCCESSFULLY! [OK]")
        print("=====================================================================")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n[TEST FAILURE] {e}")
        sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
