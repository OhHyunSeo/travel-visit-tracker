# Field Testing Guide

## Overview

This document provides comprehensive instructions for manual field testing of the Travel Visit Tracker app. These tests validate real-world behavior that cannot be fully simulated in automated tests, including GPS signal handling, permission flows, app lifecycle management, offline operation, and battery performance.

## Prerequisites

### Required Equipment
- Physical iOS device (iPhone) running iOS 12.0 or later
- Active cellular data plan or WiFi access
- Ability to travel to different geographic locations
- Battery monitoring tools (iOS Settings > Battery)
- Stopwatch or timer app

### Test Environment Setup
1. Install the Travel Visit Tracker app on the test device
2. Ensure the device has sufficient storage (at least 500 MB free)
3. Charge device to 100% before battery impact testing
4. Have access to areas with varying GPS signal quality
5. Prepare test photos (3-5 sample images) for photo attachment testing

### Pre-Test Checklist
- [ ] App installed and launches successfully
- [ ] Device has active internet connection
- [ ] Location services enabled in device settings
- [ ] Camera/photo library access available
- [ ] Device fully charged (for battery test)
- [ ] Test data sheet prepared for recording results

---

## Test 1: Weak GPS Signal Area Testing

**Objective**: Verify the app handles poor GPS signal gracefully and prevents false positive visit confirmations

**Requirements Tested**: Requirement 1 (Visit Authentication), Requirement 7 (iOS Constraints)

### Test Procedure

1. **Identify Weak Signal Location**
   - Find an area with known poor GPS reception (underground parking, dense urban canyon, indoor mall)
   - Verify weak signal by checking iOS Maps app (blue location dot should be large/uncertain)

2. **Initial Setup**
   - Launch the app with location permission granted
   - Load a GeoJSON pack for your current country
   - Note the current monitored regions count

3. **Enter Weak Signal Area**
   - Move into the weak signal location
   - Observe the app behavior for 10 minutes
   - Record any visit candidates created

4. **Monitor Visit Candidate Behavior**
   - Check if any visit candidates are created
   - Note the accuracy of location updates (if visible in debug mode)
   - Verify no false confirmations occur due to GPS drift

5. **Exit and Return to Strong Signal**
   - Move back to an area with good GPS reception
   - Verify the app recovers and resumes normal operation
   - Check that monitored regions are updated correctly

### Expected Results
- ✅ App should not crash or freeze in weak signal areas
- ✅ Visit candidates should only be created when GPS accuracy is sufficient
- ✅ No false positive confirmations from GPS drift
- ✅ Location service should handle CLError gracefully (check logs)
- ✅ App should recover smoothly when signal improves

### Data to Record
| Metric | Value |
|--------|-------|
| Location type | (e.g., underground parking) |
| Time in weak signal area | ___ minutes |
| Visit candidates created | ___ |
| False confirmations | ___ |
| App crashes/freezes | Yes / No |
| Recovery time after signal restore | ___ seconds |

### Failure Criteria
- ❌ App crashes or becomes unresponsive
- ❌ False visit confirmations occur
- ❌ App fails to recover when signal improves
- ❌ Excessive battery drain (>10% in 10 minutes)

---

## Test 2: Permission Flow Testing

**Objective**: Verify the app correctly handles all location permission states and transitions

**Requirements Tested**: Requirement 8 (Permission Requests)

### Test Procedure

#### Phase 1: Fresh Install - Initial Permission Request

1. **Clean Install**
   - Uninstall the app completely
   - Reinstall from TestFlight or Xcode
   - Launch the app

2. **Onboarding Screen**
   - Verify onboarding screen appears
   - Read the location usage explanation
   - Confirm it clearly explains why location is needed

3. **Grant "When In Use" Permission**
   - Tap "Enable Location" button
   - iOS permission dialog should appear
   - Select "Allow While Using App"
   - Verify app acknowledges the permission

4. **Verify Limited Functionality**
   - Check that visit tracking is limited
   - Verify UI indicates "Always" permission is recommended
   - Confirm map loads and displays correctly

#### Phase 2: Upgrade to "Always" Permission

1. **Trigger "Always" Request**
   - App should automatically request "Always" permission after granting "When In Use"
   - iOS dialog should appear with "Change to Always Allow" option

2. **Grant "Always" Permission**
   - Select "Change to Always Allow"
   - Verify app acknowledges the upgrade

3. **Verify Full Functionality**
   - Confirm background monitoring is enabled
   - Check that monitored regions are registered (up to 20)
   - Verify UI no longer shows permission warning

#### Phase 3: Permission Revocation

1. **Revoke Permission via Settings**
   - Open iOS Settings > Privacy > Location Services
   - Find Travel Visit Tracker
   - Change to "Never"

2. **Return to App**
   - Switch back to the app
   - Verify app detects permission change within 1 second

3. **Check Graceful Degradation**
   - Verify alert appears explaining location is required
   - Confirm "Open Settings" button is present
   - Check that visit tracking is disabled
   - Verify map still displays (but no location tracking)

#### Phase 4: Re-grant Permission

1. **Tap "Open Settings" Button**
   - Verify it opens iOS Settings to the correct location

2. **Re-enable Permission**
   - Change back to "Always Allow"
   - Return to app

3. **Verify Recovery**
   - Confirm visit tracking resumes
   - Check monitored regions are re-registered
   - Verify UI updates to show active status

### Expected Results
- ✅ Onboarding screen appears on first launch
- ✅ Permission dialogs use correct NSLocationUsageDescription text
- ✅ "When In Use" permission enables limited functionality
- ✅ "Always" permission enables full background monitoring
- ✅ Permission revocation is detected within 1 second
- ✅ Graceful degradation occurs when permission denied
- ✅ "Open Settings" button works correctly
- ✅ App recovers fully when permission re-granted

### Data to Record
| Permission State | Functionality Available | UI Indicators | Response Time |
|------------------|-------------------------|---------------|---------------|
| Never | | | |
| When In Use | | | |
| Always | | | |
| Revoked → Re-granted | | | |

### Failure Criteria
- ❌ App crashes on permission change
- ❌ Permission dialogs show generic or incorrect text
- ❌ App doesn't detect permission changes
- ❌ "Open Settings" button doesn't work
- ❌ App doesn't recover after re-granting permission

---

## Test 3: App Restart and Persistence Testing

**Objective**: Verify visit data and app state persist correctly across app restarts

**Requirements Tested**: Requirement 1.5 (State Restoration), Requirement 9 (Offline Operation)

### Test Procedure

#### Phase 1: Create Test Data

1. **Confirm Multiple Visits**
   - Travel to at least 3 different regions
   - Wait for each visit to confirm (300 seconds dwell time)
   - Verify each region turns green on the map
   - Note the region names and visit timestamps

2. **Attach Photos**
   - Attach 1-2 photos to at least one visited region
   - Verify photos appear in the region detail panel

3. **Record Current State**
   - Note total visit count
   - Screenshot the map showing visited regions
   - Record monitored region count

#### Phase 2: Force Quit App

1. **Force Quit**
   - Double-tap home button (or swipe up on iPhone X+)
   - Swipe up on the app to force quit
   - Verify app is completely closed (not in background)

2. **Wait Period**
   - Wait at least 30 seconds
   - Optionally restart the device for more thorough testing

#### Phase 3: Relaunch and Verify

1. **Relaunch App**
   - Tap app icon to launch
   - Observe launch behavior

2. **Verify Visit History**
   - Check that all confirmed visits are still present
   - Verify visited regions are still colored green
   - Confirm visit timestamps match recorded values
   - Check total visit count in stats screen

3. **Verify Photos**
   - Open region detail panels for regions with photos
   - Confirm photos are still displayed
   - Verify thumbnails load correctly

4. **Verify Monitored Regions**
   - Check that monitored regions are restored
   - Verify the app resumes monitoring (check logs if available)
   - Confirm region monitoring count matches pre-restart value

5. **Verify App State**
   - Check premium unlock status (if previously unlocked)
   - Verify selected country pack is still loaded
   - Confirm map position and zoom level (if saved)

### Expected Results
- ✅ All confirmed visits persist after restart
- ✅ Visited regions remain colored correctly
- ✅ Visit timestamps are preserved
- ✅ Photos remain attached to regions
- ✅ Monitored regions are restored (up to 20)
- ✅ Background monitoring resumes automatically
- ✅ App state (premium status, loaded packs) persists
- ✅ No data loss or corruption

### Data to Record
| Data Type | Before Restart | After Restart | Match? |
|-----------|----------------|---------------|--------|
| Total visits | | | ☐ |
| Visited region IDs | | | ☐ |
| Visit timestamps | | | ☐ |
| Attached photos | | | ☐ |
| Monitored regions | | | ☐ |
| Premium status | | | ☐ |

### Failure Criteria
- ❌ Visit data is lost or corrupted
- ❌ Photos disappear or fail to load
- ❌ Monitored regions are not restored
- ❌ App crashes on launch after restart
- ❌ Background monitoring doesn't resume

---

## Test 4: Offline Operation Testing

**Objective**: Verify the app functions correctly without internet connectivity and syncs properly when reconnected

**Requirements Tested**: Requirement 9 (Offline Operation), Requirement 3.5 (Photo Sync)

### Test Procedure

#### Phase 1: Online Setup

1. **Load GeoJSON Pack**
   - Ensure device has internet connection
   - Launch app and load a country GeoJSON pack
   - Verify pack loads successfully
   - Confirm regions display on map

2. **Verify Cache**
   - Check that GeoJSON is cached locally
   - Note the number of regions loaded

#### Phase 2: Go Offline

1. **Enable Airplane Mode**
   - Swipe down Control Center
   - Enable Airplane Mode
   - Verify no internet connectivity (WiFi and cellular off)

2. **Verify Map Renders**
   - Return to app
   - Confirm map still displays from cache
   - Verify all regions are visible
   - Check that zoom and pan work normally

#### Phase 3: Confirm Visits Offline

1. **Simulate Visit** (if possible)
   - Travel to a new region (or use location simulation in Xcode)
   - Wait for visit candidate creation
   - Wait 300 seconds for confirmation
   - Verify region turns green on map

2. **Check Visit Recording**
   - Confirm visit is recorded locally
   - Verify timestamp is captured
   - Check stats screen shows updated count

#### Phase 4: Attach Photos Offline

1. **Select Visited Region**
   - Tap on a visited region
   - Open region detail panel

2. **Attach Photo**
   - Tap photo attachment button
   - Select a photo from library
   - Verify photo is added to region

3. **Verify Local Storage**
   - Confirm photo thumbnail displays immediately
   - Check that photo is stored locally
   - Verify "Will sync when online" indicator appears (if implemented)

4. **Attach Multiple Photos**
   - Attach 2-3 more photos to different regions
   - Note the total pending uploads

#### Phase 5: Restore Connectivity

1. **Disable Airplane Mode**
   - Turn off Airplane Mode
   - Wait for internet connection to restore
   - Verify connectivity (check WiFi/cellular icon)

2. **Verify Automatic Sync**
   - Return to app (or wait if app is in foreground)
   - Observe sync process (should start within 30 seconds)
   - Monitor pending upload count

3. **Verify Photo Sync**
   - Check that photos upload to backend
   - Verify remote URLs are stored
   - Confirm "pending upload" indicators disappear
   - Check that photos remain visible in detail panels

4. **Verify Visit Sync**
   - Confirm offline visits are preserved
   - Verify no data loss occurred during offline period

### Expected Results
- ✅ Map renders from cache when offline
- ✅ Visit detection continues to work offline
- ✅ Visits are recorded locally with correct timestamps
- ✅ Photos can be attached offline
- ✅ Photos display from local cache immediately
- ✅ Sync starts automatically within 30 seconds of connectivity restore
- ✅ All pending photos upload successfully
- ✅ No data loss during offline period
- ✅ App remains responsive throughout

### Data to Record
| Metric | Value |
|--------|-------|
| Regions loaded before offline | ___ |
| Visits confirmed while offline | ___ |
| Photos attached while offline | ___ |
| Time to start sync after reconnect | ___ seconds |
| Photos successfully synced | ___ / ___ |
| Sync failures | ___ |
| Data loss incidents | ___ |

### Failure Criteria
- ❌ Map fails to render when offline
- ❌ Visit detection stops working offline
- ❌ Photos cannot be attached offline
- ❌ Sync doesn't start automatically
- ❌ Photos fail to upload after reconnect
- ❌ Data is lost or corrupted
- ❌ App crashes when going offline or online

---

## Test 5: Battery Impact Measurement

**Objective**: Measure battery consumption over an 8-hour period to ensure acceptable power efficiency

**Requirements Tested**: Requirement 7 (iOS Constraints), Design Performance Considerations

### Test Procedure

#### Phase 1: Preparation

1. **Device Setup**
   - Fully charge device to 100%
   - Close all other apps
   - Disable unnecessary background app refresh for other apps
   - Set screen brightness to 50%
   - Disable auto-lock or set to 5 minutes

2. **App Configuration**
   - Launch Travel Visit Tracker
   - Grant "Always" location permission
   - Load a GeoJSON pack for your area
   - Verify background monitoring is active
   - Note the number of monitored regions (should be up to 20)

3. **Baseline Recording**
   - Go to Settings > Battery
   - Screenshot current battery level (100%)
   - Note the time
   - Record any battery usage from previous 24 hours (for comparison)

#### Phase 2: 8-Hour Monitoring Period

1. **Normal Usage Simulation**
   - Keep device in pocket or bag (simulating real-world carry)
   - Move around normally (walk, drive, public transit)
   - Optionally travel through multiple regions to trigger monitoring
   - Check app 2-3 times during the period (open for 1-2 minutes each)
   - Do NOT use other apps extensively (to isolate Travel Visit Tracker impact)

2. **Periodic Checks** (every 2 hours)
   - Record battery level
   - Screenshot Settings > Battery screen
   - Note any unusual behavior (device heating, rapid drain)
   - Check app is still running in background (if possible)

#### Phase 3: Results Analysis

1. **Final Recording** (after 8 hours)
   - Record final battery level
   - Go to Settings > Battery
   - Find Travel Visit Tracker in the battery usage list
   - Screenshot the battery usage breakdown
   - Note percentage of battery used by the app

2. **Calculate Metrics**
   - Total battery drain: 100% - final level = ____%
   - App-specific drain: ____%
   - Drain per hour: total drain / 8 = ____% per hour
   - Projected 24-hour drain: drain per hour × 24 = ____%

3. **Compare with Baseline**
   - Compare with typical 8-hour drain without the app
   - Calculate additional drain caused by the app
   - Verify drain is acceptable (<5% per 8 hours target)

### Expected Results
- ✅ Total battery drain over 8 hours: <40% (typical smartphone usage)
- ✅ App-specific drain: <5% over 8 hours
- ✅ No excessive device heating
- ✅ Background monitoring remains active throughout
- ✅ Drain rate is consistent (no sudden spikes)
- ✅ Comparable to or better than other location-based apps

### Data to Record

| Time | Battery Level | App Usage % | Notes |
|------|---------------|-------------|-------|
| 0:00 (start) | 100% | 0% | Baseline |
| 2:00 | ___% | ___% | |
| 4:00 | ___% | ___% | |
| 6:00 | ___% | ___% | |
| 8:00 (end) | ___% | ___% | Final |

**Summary Metrics:**
- Total drain: ____%
- App-specific drain: ____%
- Drain per hour: ____%
- Projected 24-hour drain: ____%
- Device heating: Yes / No
- Background monitoring active: Yes / No

### Failure Criteria
- ❌ App-specific drain exceeds 5% over 8 hours
- ❌ Device experiences excessive heating
- ❌ Battery drain rate is inconsistent or spikes suddenly
- ❌ Background monitoring stops working
- ❌ App causes device to drain faster than 10% per hour

---

## Test Results Summary Template

### Overall Test Summary

**Test Date:** ___________  
**Tester Name:** ___________  
**Device Model:** ___________  
**iOS Version:** ___________  
**App Version:** ___________

### Test Results Overview

| Test | Status | Critical Issues | Notes |
|------|--------|-----------------|-------|
| 1. Weak GPS Signal | ☐ Pass ☐ Fail | | |
| 2. Permission Flow | ☐ Pass ☐ Fail | | |
| 3. App Restart | ☐ Pass ☐ Fail | | |
| 4. Offline Operation | ☐ Pass ☐ Fail | | |
| 5. Battery Impact | ☐ Pass ☐ Fail | | |

### Critical Issues Found

1. **Issue:** ___________  
   **Severity:** High / Medium / Low  
   **Test:** ___________  
   **Steps to Reproduce:** ___________  
   **Expected:** ___________  
   **Actual:** ___________

2. **Issue:** ___________  
   **Severity:** High / Medium / Low  
   **Test:** ___________  
   **Steps to Reproduce:** ___________  
   **Expected:** ___________  
   **Actual:** ___________

### Recommendations

- [ ] Ready for production release
- [ ] Requires minor fixes before release
- [ ] Requires major fixes before release
- [ ] Requires additional testing

**Additional Notes:**
___________________________________________________________________________
___________________________________________________________________________
___________________________________________________________________________

---

## Troubleshooting Common Issues

### Issue: Visit not confirming after 300 seconds

**Possible Causes:**
- GPS accuracy too low
- User moved outside region boundary
- Region monitoring not active

**Debug Steps:**
1. Check location permission is "Always"
2. Verify region is in monitored slots (check logs)
3. Confirm GPS accuracy is <100 meters
4. Verify region boundary geometry is correct

### Issue: Photos not syncing after reconnect

**Possible Causes:**
- Backend server unreachable
- Network timeout
- Photo file corrupted

**Debug Steps:**
1. Check internet connectivity
2. Verify backend server is running
3. Check app logs for upload errors
4. Try manual sync (if implemented)

### Issue: Excessive battery drain

**Possible Causes:**
- Too many monitored regions
- Continuous location updates instead of region monitoring
- Background sync running too frequently

**Debug Steps:**
1. Verify only 20 regions are monitored
2. Check location service is using region monitoring (not continuous)
3. Review background sync frequency
4. Check for location update loops in logs

### Issue: App crashes on permission change

**Possible Causes:**
- Location service not handling state change
- UI not updating on permission callback
- Race condition in state management

**Debug Steps:**
1. Review crash logs
2. Check permission change handler implementation
3. Verify UI updates are on main thread
4. Test with different permission transition sequences

---

## Appendix: Test Data Collection Tools

### Battery Monitoring Script

For more detailed battery monitoring, you can use Xcode Instruments:

1. Connect device to Mac
2. Open Xcode > Open Developer Tool > Instruments
3. Select "Energy Log" template
4. Select your device and app
5. Record for 8-hour period
6. Analyze energy usage breakdown

### Location Simulation

For controlled testing without physical travel:

1. In Xcode, select your device
2. Go to Debug > Simulate Location
3. Choose a GPX file or custom location
4. Move between locations to trigger region monitoring

### Network Condition Simulation

To test various network conditions:

1. In Xcode, go to Debug > Network Link Conditioner
2. Enable and select profile (3G, LTE, 100% Loss, etc.)
3. Test app behavior under different conditions

---

## Sign-Off

**Tester Signature:** ___________  
**Date:** ___________  
**Approved for Release:** ☐ Yes ☐ No  
**Reviewer Signature:** ___________  
**Date:** ___________
