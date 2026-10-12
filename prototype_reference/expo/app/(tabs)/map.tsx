import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Info, Navigation } from 'lucide-react-native';
import { GlassCard } from '../../components/ui/GlassCard';
import { Badge } from '../../components/ui/Badge';
import * as d3 from 'd3-shape';

// Mock Data for Curve
const POINTS = [
    { latitude: 48.8566, longitude: 2.3522 }, // Paris
    { latitude: 48.8606, longitude: 2.3376 }, // Louvre
    { latitude: 48.8867, longitude: 2.3431 }, // Montmartre
    { latitude: 48.8738, longitude: 2.2950 }, // Arc de Triomphe
    { latitude: 48.8584, longitude: 2.2945 }, // Eiffel
];

// Simple line generator for now (Bezier logic needs complex projection in RN, using simplified Catmull-Rom or standard Polyline for MVP stability)
// For true d3 projection, we'd need to convert lat/lng to screen coordinates, which is complex in MapView.
// Swapping to standard Polyline with high styling for MVP as per "Zero Data Loss" priority first.

export default function MapScreen() {
    return (
        <View className="flex-1 bg-black">
            <Stack.Screen options={{ headerShown: false }} />

            {/* Map */}
            <MapView
                provider={PROVIDER_DEFAULT}
                style={StyleSheet.absoluteFill}
                initialRegion={{
                    latitude: 48.8566,
                    longitude: 2.3522,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                userInterfaceStyle="dark"
                customMapStyle={DARK_MAP_STYLE}
            >
                <Polyline
                    coordinates={POINTS}
                    strokeColor="#00CED1"
                    strokeWidth={4}
                    lineDashPattern={[0]}
                />
                <Marker coordinate={POINTS[2]}>
                    <View className="w-4 h-4 rounded-full bg-primary border-2 border-white" />
                </Marker>
            </MapView>

            <SafeAreaView className="flex-1 pointer-events-none" edges={['top']}>
                {/* Top Bar */}
                <View className="px-5 pt-2 flex-row justify-between items-center pointer-events-auto">
                    <GlassCard className="!rounded-full !p-2" onTouchEnd={() => router.back()}>
                        <ChevronLeft size={24} color="white" />
                    </GlassCard>
                    <GlassCard className="!rounded-full !p-2">
                        <Info size={24} color="white" />
                    </GlassCard>
                </View>
            </SafeAreaView>

            {/* Bottom Sheet Overlay */}
            <View className="absolute bottom-10 left-5 right-5 pointer-events-auto">
                <GlassCard className="!p-0 overflow-hidden">
                    <View className="bg-primary/20 p-2 flex-row justify-center items-center">
                        <View className="w-2 h-2 rounded-full bg-primary mr-2 animate-pulse" />
                        <Text className="text-primary text-xs font-bold tracking-widest">PASSIVE TRACKING ACTIVE</Text>
                    </View>
                    <View className="p-5">
                        <View className="flex-row justify-between items-start">
                            <View>
                                <Text className="text-white text-3xl font-bold">Montmartre</Text>
                                <Text className="text-gray-400 text-base">Paris, France</Text>
                            </View>
                            <View className="w-10 h-10 rounded-full bg-white/10 items-center justify-center">
                                <Navigation size={20} color="#9CA3AF" />
                            </View>
                        </View>

                        <View className="h-[1px] bg-white/10 my-4" />

                        <View className="flex-row justify-between">
                            <View>
                                <Text className="text-gray-400 text-xs mb-1 uppercase">Duration</Text>
                                <Text className="text-white text-xl font-bold">12 <Text className="text-base font-normal text-primary">Days</Text></Text>
                            </View>
                            <View className="w-[1px] bg-white/10" />
                            <View>
                                <Text className="text-gray-400 text-xs mb-1 uppercase">Distance</Text>
                                <Text className="text-white text-xl font-bold">450 <Text className="text-base font-normal text-primary">km</Text></Text>
                            </View>
                        </View>
                    </View>
                </GlassCard>
            </View>
        </View>
    );
}

const DARK_MAP_STYLE = [
    {
        "elementType": "geometry",
        "stylers": [{ "color": "#212121" }]
    },
    {
        "elementType": "labels.icon",
        "stylers": [{ "visibility": "off" }]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#212121" }]
    },
    {
        "featureType": "administrative",
        "elementType": "geometry",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "poi",
        "elementType": "geometry",
        "stylers": [{ "color": "#181818" }]
    },
    {
        "featureType": "road",
        "elementType": "geometry.fill",
        "stylers": [{ "color": "#2c2c2c" }]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [{ "color": "#000000" }]
    }
];
