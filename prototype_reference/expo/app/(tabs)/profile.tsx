import { View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings, Edit2, Map, Award, Camera, Plane } from 'lucide-react-native';
import { GlassCard } from '../../components/ui/GlassCard';
import { useTripStore } from '../../store/useTripStore';

export default function ProfileScreen() {
    const { user } = useTripStore();

    const BADGES = [
        { id: 1, icon: <Map size={24} color="#FBBF24" />, label: 'Hiker', color: 'text-amber-400' },
        { id: 2, icon: <Plane size={24} color="#60A5FA" />, label: 'Jetsetter', color: 'text-blue-400' },
        { id: 3, icon: <Camera size={24} color="#34D399" />, label: 'Snapper', color: 'text-emerald-400' },
    ];

    return (
        <SafeAreaView className="flex-1 bg-background">
            <Stack.Screen options={{ headerShown: false }} />

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View className="px-5 pt-2 flex-row justify-between items-center mb-8">
                    <Text className="text-white text-lg font-bold">Profile</Text>
                    <TouchableOpacity>
                        <Settings size={24} color="white" />
                    </TouchableOpacity>
                </View>

                {/* Profile Info */}
                <View className="items-center mb-8">
                    <View className="relative">
                        <View className="w-32 h-32 rounded-full border-2 border-primary p-1">
                            <View className="w-full h-full rounded-full bg-gray-600 overflow-hidden items-center justify-center">
                                <Text className="text-4xl">😎</Text>
                            </View>
                        </View>
                        <View className="absolute bottom-0 right-0 bg-primary px-2 py-0.5 rounded-full border border-black">
                            <Text className="text-black text-xs font-bold">PRO</Text>
                        </View>
                    </View>

                    <Text className="text-white text-2xl font-bold mt-4">{user.name} Wanderer</Text>
                    <Text className="text-gray-400 text-center mt-2 px-10">
                        Digital nomad exploring the hidden corners of the Pacific.
                    </Text>

                    <View className="flex-row items-center mt-2">
                        <MapPinIcon size={12} color="#F87171" />
                        <Text className="text-primary text-sm ml-1">Currently in Kyoto</Text>
                    </View>

                    <TouchableOpacity className="mt-6 flex-row items-center px-4 py-2 rounded-full border border-white/20 bg-white/5">
                        <Edit2 size={14} color="white" className="mr-2" />
                        <Text className="text-white text-sm font-medium">Edit Profile</Text>
                    </TouchableOpacity>
                </View>

                {/* Stats Row */}
                <View className="flex-row justify-between px-5 mb-8">
                    <StatsCard label="TRIPS" value={user.tripsCount} />
                    <StatsCard label="COUNTRIES" value={user.countriesCount} />
                    <StatsCard label="KM" value="42k" />
                </View>

                {/* Current Journey (Map Widget) */}
                <View className="px-5 mb-8">
                    <View className="flex-row justify-between items-center mb-4">
                        <Text className="text-white text-lg font-bold">Current Journey</Text>
                        <Text className="text-primary text-sm">View Map</Text>
                    </View>
                    <GlassCard className="h-40 !p-0 overflow-hidden justify-end">
                        <View className="absolute inset-0 bg-gray-800" />
                        {/* Map Placeholder */}
                        <View className="absolute inset-0 opacity-50 bg-[url('https://maps.googleapis.com/maps/api/staticmap?center=Kyoto,Japan&zoom=10&size=600x300')]" />

                        <View className="p-4 bg-gradient-to-t from-black/80 to-transparent">
                            <Text className="text-white text-xl font-bold">Kyoto</Text>
                            <Text className="text-gray-300 text-xs">Japan • Arrived 2 days ago</Text>
                        </View>
                    </GlassCard>
                </View>

                {/* Badges */}
                <View className="px-5 mb-10">
                    <Text className="text-white text-lg font-bold mb-4">Recent Badges</Text>
                    <View className="flex-row justify-between">
                        {BADGES.map((badge) => (
                            <GlassCard key={badge.id} className="w-[30%] aspect-square items-center justify-center !p-2 bg-white/5">
                                {badge.icon}
                                <Text className="text-white text-xs font-bold mt-2">{badge.label}</Text>
                            </GlassCard>
                        ))}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function StatsCard({ label, value }: { label: string, value: string | number }) {
    return (
        <GlassCard className="w-[30%] items-center !py-4 bg-white/5">
            <Text className="text-primary text-xl font-bold">{value}</Text>
            <Text className="text-gray-400 text-[10px] uppercase mt-1">{label}</Text>
        </GlassCard>
    );
}

// Icon Helper
function MapPinIcon({ size, color }: { size: number, color: string }) {
    return <View style={{ width: size, height: size, backgroundColor: color, borderRadius: size }} />;
}
