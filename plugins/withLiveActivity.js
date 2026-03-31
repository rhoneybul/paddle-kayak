/**
 * Expo config plugin — adds an iOS Widget Extension for Live Activities (ActivityKit).
 *
 * When `npx expo prebuild` runs, this plugin:
 * 1. Creates a SolvaaWidgetExtension target in the Xcode project
 * 2. Adds the Swift source files for the Live Activity UI
 * 3. Configures the extension's Info.plist and entitlements
 * 4. Adds the native module bridge (SolvaaLiveActivity) to the main app target
 */
const {
  withXcodeProject,
  withInfoPlist,
  withEntitlementsPlist,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WIDGET_TARGET_NAME = 'SolvaaWidgetExtension';
const BUNDLE_ID_SUFFIX = '.SolvaaWidgetExtension';

// ── Swift source for the Widget Extension ───────────────────────────────────

const ATTRIBUTES_SWIFT = `
import ActivityKit
import Foundation

struct PaddleActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var distanceKm: Double
        var elapsedSeconds: Int
        var speedKmh: Double
    }

    var paddleName: String
    var routeName: String
}
`;

const WIDGET_SWIFT = `
import WidgetKit
import SwiftUI
import ActivityKit

func formatDuration(_ totalSeconds: Int) -> String {
    let h = totalSeconds / 3600
    let m = (totalSeconds % 3600) / 60
    let s = totalSeconds % 60
    if h > 0 {
        return String(format: "%d:%02d:%02d", h, m, s)
    }
    return String(format: "%02d:%02d", m, s)
}

struct PaddleLiveActivityView: View {
    let context: ActivityViewContext<PaddleActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.paddleName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                if !context.attributes.routeName.isEmpty {
                    Text(context.attributes.routeName)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            Spacer()
            HStack(spacing: 14) {
                VStack(spacing: 1) {
                    Text(String(format: "%.1f", context.state.distanceKm))
                        .font(.system(size: 20, weight: .light, design: .rounded))
                        .foregroundColor(.white)
                    Text("km")
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.6))
                }
                VStack(spacing: 1) {
                    Text(formatDuration(context.state.elapsedSeconds))
                        .font(.system(size: 20, weight: .light, design: .rounded))
                        .foregroundColor(.white)
                    Text("time")
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.6))
                }
                VStack(spacing: 1) {
                    Text(String(format: "%.1f", context.state.speedKmh))
                        .font(.system(size: 20, weight: .light, design: .rounded))
                        .foregroundColor(.white)
                    Text("km/h")
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

@available(iOS 16.1, *)
struct PaddleLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PaddleActivityAttributes.self) { context in
            // Lock screen banner
            PaddleLiveActivityView(context: context)
                .activityBackgroundTint(Color(red: 0.29, green: 0.42, blue: 0.97)) // #4A6CF7
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.paddleName)
                            .font(.system(size: 13, weight: .semibold))
                        Text(String(format: "%.1f km", context.state.distanceKm))
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatDuration(context.state.elapsedSeconds))
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                        Text(String(format: "%.1f km/h", context.state.speedKmh))
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(.trailing, 4)
                }
            } compactLeading: {
                Text(String(format: "%.1f km", context.state.distanceKm))
                    .font(.system(size: 11, weight: .medium))
            } compactTrailing: {
                Text(formatDuration(context.state.elapsedSeconds))
                    .font(.system(size: 11, weight: .medium, design: .rounded))
            } minimal: {
                Text(String(format: "%.1f", context.state.distanceKm))
                    .font(.system(size: 11, weight: .medium))
            }
        }
    }
}

@main
struct SolvaaWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            PaddleLiveActivity()
        }
    }
}
`;

const NATIVE_MODULE_SWIFT = `
import Foundation
import ActivityKit

@objc(SolvaaLiveActivity)
class SolvaaLiveActivity: NSObject {

    private var currentActivity: Any? = nil

    @objc
    func start(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        if #available(iOS 16.1, *) {
            let paddleName = params["paddleName"] as? String ?? "Paddle"
            let routeName = params["routeName"] as? String ?? ""
            let attrs = PaddleActivityAttributes(paddleName: paddleName, routeName: routeName)
            let state = PaddleActivityAttributes.ContentState(
                distanceKm: params["distanceKm"] as? Double ?? 0,
                elapsedSeconds: params["elapsedSeconds"] as? Int ?? 0,
                speedKmh: params["speedKmh"] as? Double ?? 0
            )
            do {
                let activity = try Activity.request(
                    attributes: attrs,
                    content: .init(state: state, staleDate: nil),
                    pushType: nil
                )
                currentActivity = activity
                resolve(true)
            } catch {
                reject("LIVE_ACTIVITY_ERROR", error.localizedDescription, error)
            }
        } else {
            reject("UNSUPPORTED", "Live Activities require iOS 16.1+", nil)
        }
    }

    @objc
    func update(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        if #available(iOS 16.1, *) {
            guard let activity = currentActivity as? Activity<PaddleActivityAttributes> else {
                resolve(false)
                return
            }
            let state = PaddleActivityAttributes.ContentState(
                distanceKm: params["distanceKm"] as? Double ?? 0,
                elapsedSeconds: params["elapsedSeconds"] as? Int ?? 0,
                speedKmh: params["speedKmh"] as? Double ?? 0
            )
            Task {
                await activity.update(.init(state: state, staleDate: nil))
                resolve(true)
            }
        } else {
            resolve(false)
        }
    }

    @objc
    func end(_ params: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        if #available(iOS 16.1, *) {
            guard let activity = currentActivity as? Activity<PaddleActivityAttributes> else {
                resolve(false)
                return
            }
            let state = PaddleActivityAttributes.ContentState(
                distanceKm: params["distanceKm"] as? Double ?? 0,
                elapsedSeconds: params["elapsedSeconds"] as? Int ?? 0,
                speedKmh: 0
            )
            Task {
                await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .default)
                currentActivity = nil
                resolve(true)
            }
        } else {
            resolve(false)
        }
    }

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
`;

const NATIVE_MODULE_OBJC_BRIDGE = `
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SolvaaLiveActivity, NSObject)

RCT_EXTERN_METHOD(start:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(update:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(end:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
`;

// ── Config plugin implementation ────────────────────────────────────────────

function withLiveActivity(config) {
  // 1. Add NSSupportsLiveActivities to Info.plist
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    mod.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return mod;
  });

  // 2. Write Swift source files for the widget extension and native module
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const iosRoot = path.join(projectRoot, 'ios');

      // Widget extension sources
      const widgetDir = path.join(iosRoot, WIDGET_TARGET_NAME);
      fs.mkdirSync(widgetDir, { recursive: true });
      fs.writeFileSync(path.join(widgetDir, 'PaddleActivityAttributes.swift'), ATTRIBUTES_SWIFT.trim());
      fs.writeFileSync(path.join(widgetDir, 'SolvaaWidget.swift'), WIDGET_SWIFT.trim());

      // Info.plist for the widget extension
      const widgetInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Solvaa Widget</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`;
      fs.writeFileSync(path.join(widgetDir, 'Info.plist'), widgetInfoPlist);

      // Native module bridge in the main app target
      const appName = mod.modRequest.projectName || 'kayakplanner';
      const appDir = path.join(iosRoot, appName);
      fs.mkdirSync(appDir, { recursive: true });

      // Write the ActivityAttributes file into the main app too (shared type)
      fs.writeFileSync(path.join(appDir, 'PaddleActivityAttributes.swift'), ATTRIBUTES_SWIFT.trim());
      fs.writeFileSync(path.join(appDir, 'SolvaaLiveActivity.swift'), NATIVE_MODULE_SWIFT.trim());
      fs.writeFileSync(path.join(appDir, 'SolvaaLiveActivity.m'), NATIVE_MODULE_OBJC_BRIDGE.trim());

      return mod;
    },
  ]);

  return config;
}

module.exports = withLiveActivity;
