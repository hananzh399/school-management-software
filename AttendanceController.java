package com.softschool.backend.controller;

import com.softschool.backend.model.Attendance;
import com.softschool.backend.repository.AttendanceRepository;
import com.softschool.backend.service.ZktecoService;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/attendance")
@CrossOrigin(origins = "*")
public class AttendanceController {

    @Autowired
    private AttendanceRepository attendanceRepository;

    @PostMapping("/save")
    public ResponseEntity<String> saveAttendance(@RequestBody List<Attendance> attendanceList) {
        if (attendanceList == null || attendanceList.isEmpty()) {
            return ResponseEntity.badRequest().body("No records provided");
        }
        // Every record MUST carry its schoolId, or it becomes impossible to
        // tell which school it belongs to once saved (and can collide with
        // another school's data on the same memberId/date).
        for (Attendance a : attendanceList) {
            if (a.getSchoolId() == null || a.getSchoolId().trim().isEmpty()) {
                return ResponseEntity.badRequest()
                        .body("schoolId is required on every attendance record (missing for memberId="
                                + a.getMemberId() + ")");
            }
        }
        attendanceRepository.saveAll(attendanceList);
        return ResponseEntity.ok("Saved " + attendanceList.size() + " records successfully!");
    }

    // Inside AttendanceController.java
@Autowired
private ZktecoService zktecoService;

@GetMapping("/test-biometric")
public String testBiometric(@RequestParam String id) {
    // Fix for Error 2: We must pass a LocalTime. 
    // We use LocalTime.now() to pretend the scan is happening exactly now.
    zktecoService.markAttendance(id, "Test User", java.time.LocalTime.now()); 
    
    return "Fingerprint process triggered for ID: " + id;
}

@GetMapping("/staff")
public ResponseEntity<?> getStaffAttendance(@RequestParam String date, @RequestParam String schoolId) {
    // This returns all marked staff for today (biometric or manual), for ONE school only.
    if (schoolId == null || schoolId.trim().isEmpty()) {
        return ResponseEntity.badRequest().body("schoolId is required");
    }
    return ResponseEntity.ok(
            attendanceRepository.findByMemberTypeAndDateAndSchoolId("STAFF", LocalDate.parse(date), schoolId));
}

// Full attendance history for one member (staff or student), scoped to
// their school so the frontend's "History" view never shows another
// school's records even if the memberId string happens to match.
@GetMapping("/history/{memberId}")
public ResponseEntity<?> getMemberHistory(@PathVariable String memberId, @RequestParam String schoolId) {
    if (schoolId == null || schoolId.trim().isEmpty()) {
        return ResponseEntity.badRequest().body("schoolId is required");
    }
    return ResponseEntity.ok(
            attendanceRepository.findByMemberIdAndSchoolIdOrderByDateDesc(memberId, schoolId));
}
}