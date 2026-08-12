package com.softschool.backend.controller;

import com.softschool.backend.model.BiometricPathRequest;
import com.softschool.backend.service.ZktecoService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/biometric")
@CrossOrigin(origins = "*") // This allows the frontend to talk to the backend
public class BiometricController {

    @Autowired
    private ZktecoService zktecoService;

    @PostMapping("/link")
    public ResponseEntity<String> linkDevice(@RequestBody BiometricPathRequest request) {
        if (request.getPath() == null || request.getPath().isEmpty()) {
            return ResponseEntity.badRequest().body("Path is empty");
        }
        // NEW: schoolId is required now too — without it the service has no
        // way to scope punches to the right school's staff (schoolId+staffId).
        if (request.getSchoolId() == null || request.getSchoolId().isEmpty()) {
            return ResponseEntity.badRequest().body("schoolId is required");
        }

        // Pass both the path and the school to our service
        zktecoService.updateMdbPath(request.getPath(), request.getSchoolId());

        return ResponseEntity.ok("Path updated successfully");
    }
}