import { View, Text, ScrollView, Image, TouchableOpacity, TextInput, ImageBackground, Dimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin, Calendar, ChevronRight, Bell, Plus, Globe } from 'lucide-react-native';
import { GlassCard } from '../../components/ui/GlassCard';
import { Badge } from '../../components/ui/Badge';
import { useTripStore } from '../../store/useTripStore';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
    const { user, activeTrip, recentTrips } = useTripStore();

    return (
        <SafeAreaView className="flex-1 bg-background-dark">
            <Stack.Screen options={{ headerShown: false }} />

            {/* Background Gradient Blobs */}
            <View className="absolute top-[-100] right-[-100] w-[400] h-[400] rounded-full bg-primary/20 blur-[100px]" pointerEvents="none" />
            <View className="absolute bottom-[-100] left-[-100] w-[300] h-[300] rounded-full bg-blue-600/20 blur-[100px]" pointerEvents="none" />

            <ScrollView className="flex-1 px-6 pt-4 pb-24" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
                {/* Header */}
                <View className="flex-row justify-between items-center mb-6">
                    <View>
                        <Text className="text-gray-400 text-sm font-medium">Welcome back</Text>
                        <Text className="text-white text-2xl font-bold mt-1 tracking-tight">
                            Hello, Alex! 👋
                        </Text>
                    </View>
                    <TouchableOpacity className="w-10 h-10 rounded-full border border-white/5 bg-white/5 items-center justify-center">
                        <Bell size={20} color="white" />
                        <View className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-primary ring-2 ring-[#102222]" />
                    </TouchableOpacity>
                </View>

                {/* Search Bar */}
                <View className="mb-8">
                    <View className="relative">
                        <View className="absolute top-0 bottom-0 left-4 justify-center z-10">
                            <Search size={20} color="#90cacb" />
                        </View>
                        <TextInput
                            placeholder="Search memories or destinations..."
                            placeholderTextColor="#90cacb"
                            className="w-full pl-12 pr-4 py-3.5 bg-[#183434]/40 border border-white/5 rounded-2xl text-white text-base"
                        />
                    </View>
                </View>

                {/* Active Journey */}
                <View className="mb-8">
                    <View className="flex-row justify-between items-end mb-4">
                        <Text className="text-white text-lg font-bold tracking-wide">Current Trip</Text>
                        <View className="bg-primary/10 px-2 py-1 rounded-full border border-primary/20">
                            <Text className="text-primary text-xs font-medium">LIVE</Text>
                        </View>
                    </View>

                    <TouchableOpacity onPress={() => router.push('/map')} activeOpacity={0.9}>
                        <GlassCard className="h-[280px] !p-0 overflow-hidden relative border-glass-border">
                            {/* Background Image */}
                            <ImageBackground
                                source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBmUHsC5dHpvofBodIJf1dqTceIbNts8JW-zeq8N5fRhzo5INwGmPZICG31pMY7PA1RSeKf1qLVis3eT1qN-abYT_wlINgRvspMF_Tupd6SWwkZ4yT3PAirIgEFQySG-W4_4OH4hZlTpZm1S2yaK38NVQwGjL2jb-u40xg6IHaX6Q9Fj0xdXJezU9c2aGzwOzeRQpaesjk_XOp_EEQV4ckJcjq5O-Kucstu1so4URsKPy-KrMSs0EvJ-D06CMQPZL0kTZ9_Q6EdWcs' }}
                                className="absolute inset-0 w-full h-full"
                                resizeMode="cover"
                            >
                                <LinearGradient
                                    colors={['rgba(16, 34, 34, 0)', 'rgba(16, 34, 34, 0.6)', '#102222']}
                                    className="absolute inset-0"
                                />
                            </ImageBackground>

                            {/* Content */}
                            <View className="flex-1 p-5 justify-between">
                                {/* Top Info */}
                                <View className="flex-row justify-between items-start">
                                    <View className="bg-black/30 px-3 py-1 rounded-lg flex-row items-center backdrop-blur-md border border-white/5">
                                        <MapPin size={16} color="#0ac4c7" />
                                        <Text className="text-white text-xs font-bold ml-1 uppercase tracking-wider">The Alps</Text>
                                    </View>

                                    {/* Mini Map Thumbnail */}
                                    <View className="w-16 h-16 rounded-xl border-2 border-white/20 overflow-hidden bg-[#1a2c2c] shadow-lg">
                                        <Image
                                            source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBkV4yxOUZCaJnzLmBSHMA9CvDf5sFzkpFgyNukic-u5twoXa21d_s4MM0znTD-A2rguKw4NzRPjUH9DR_IS1tmxxoolrtCVqllSxyq52SBKvccjm2IpqqHf5YYJcXuYJUV8O_rEp7RcqyFFjU158hqcOilYoPu8Iks4ayi7avjjdOefD-dYWTu9XfM0JjbwmvXDNVYzWEZjBUKRIjBjNr6fre0DmHdSUa4cQ86N15ZpCET27NQ9EQJchSnxzRfcyZV0vOCRhmPyQo' }}
                                            className="w-full h-full opacity-80"
                                        />
                                    </View>
                                </View>

                                {/* Bottom Stats */}
                                <View>
                                    <Text className="text-primary text-sm font-medium mb-1">Live Tracking</Text>
                                    <Text className="text-white text-2xl font-bold mb-4 leading-tight">Exploring the Alps</Text>

                                    <View className="flex-row justify-between items-center text-white/90 bg-black/20 p-3 rounded-xl border border-white/5 backdrop-blur-sm">
                                        <View className="flex-col items-center flex-1">
                                            <Text className="font-bold text-lg text-white">Day 5</Text>
                                            <Text className="text-[10px] uppercase text-gray-400">Duration</Text>
                                        </View>
                                        <View className="w-[1px] h-8 bg-white/10" />
                                        <View className="flex-col items-center flex-1">
                                            <Text className="font-bold text-lg text-white">3</Text>
                                            <Text className="text-[10px] uppercase text-gray-400">Countries</Text>
                                        </View>
                                        <View className="w-[1px] h-8 bg-white/10" />
                                        <View className="flex-col items-center flex-1">
                                            <Text className="font-bold text-lg text-white">1,200</Text>
                                            <Text className="text-[10px] uppercase text-gray-400">Kilometers</Text>
                                        </View>
                                    </View>
                                </View>
                            </View>
                        </GlassCard>
                    </TouchableOpacity>
                </View>

                {/* World Stats Widget */}
                <View className="mb-8">
                    <GlassCard className="!p-4 flex-row justify-between items-center rounded-2xl border-white/5">
                        <View className="flex-1 mr-4">
                            <Text className="text-white font-bold text-lg">World Stats</Text>
                            <Text className="text-gray-400 text-sm mt-1">
                                You've explored <Text className="text-primary font-bold">14%</Text> of the world.
                            </Text>
                            <View className="w-full bg-white/10 h-1.5 rounded-full mt-3">
                                <View className="bg-primary h-1.5 rounded-full" style={{ width: '14%' }} />
                            </View>
                        </View>
                        <View className="w-12 h-12 rounded-full bg-primary/20 items-center justify-center border border-primary/30">
                            <Globe size={24} color="#0ac4c7" />
                        </View>
                    </GlassCard>
                </View>

                {/* Recent Trips */}
                <View className="mb-8">
                    <View className="flex-row justify-between items-center mb-4">
                        <Text className="text-white text-lg font-bold tracking-wide">Recent Trips</Text>
                        <TouchableOpacity>
                            <Text className="text-primary text-sm font-medium">See all</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Hardcoded Trips to match design */}
                    <TouchableOpacity activeOpacity={0.8} className="mb-3">
                        <GlassCard className="flex-row items-center !p-3 rounded-xl border-white/5">
                            <View className="w-20 h-20 rounded-lg overflow-hidden shrink-0 relative mr-4">
                                <Image
                                    source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCz4QHtvoGwxcHVSV5MZrNQkFGxAZ8nj5DvU2eVHM7pzRLxEeDmSYTxdC9WgnkRXf-xdrdTCbha-9afz30UfnW6zveKFOiSDaT7EF0lewH9P7jpqsvLNxmTe72NPx7nwZK-J9giVxv8tgep_FAVdqHK4Px7Gssc7ZPUN1TirzC0r3e9vn5OEIuGKZzjD8rfuFUUh8RhNLJWizJ5p1Li2874GVbeZ0KQpCv1IzNJTR68KpSp4LE5XOQVjXDvEC23Bt9cFg1clvZlwPc' }}
                                    className="w-full h-full"
                                    resizeMode="cover"
                                />
                                <View className="absolute inset-0 bg-black/20" />
                            </View>
                            <View className="flex-1">
                                <Text className="text-white font-bold text-base">Iceland Roadtrip</Text>
                                <View className="flex-row items-center gap-2 mt-1">
                                    <Calendar size={14} color="#90cacb" />
                                    <Text className="text-gray-400 text-xs">Nov 01 - Nov 12, 2023</Text>
                                </View>
                                <View className="flex-row items-center gap-1 mt-2">
                                    <View className="w-2 h-2 rounded-full bg-orange-400" />
                                    <Text className="text-xs text-gray-400">12 stops</Text>
                                </View>
                            </View>
                            <ChevronRight size={20} color="#6B7280" />
                        </GlassCard>
                    </TouchableOpacity>

                    <TouchableOpacity activeOpacity={0.8}>
                        <GlassCard className="flex-row items-center !p-3 rounded-xl border-white/5">
                            <View className="w-20 h-20 rounded-lg overflow-hidden shrink-0 relative mr-4">
                                <Image
                                    source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD4fyr-nlkX6Hfkfr4nosLqyB4J7uvXYCD9UVW248UJH7b0xnE2iSXDsIY85-MZT2ZiHkPHTHXAGheTcf4vbPRm4LTt_sm3ysctGH3_vXpXgF89-pXCJtSl7VvILj5ZQutFMfbsLVom-gd4ADGfDq3D_GKE-FMHZZra3_MPh-WbZ_Jb0M2cZvt63yYANSKViZF3dGBxeKA3AvskMedmf4dDL30blCHXJCSoGi9yVLG5hXulYCN1pumbQQ0fED0peJdZwlLiYqBSC1Y' }}
                                    className="w-full h-full"
                                    resizeMode="cover"
                                />
                                <View className="absolute inset-0 bg-black/20" />
                            </View>
                            <View className="flex-1">
                                <Text className="text-white font-bold text-base">Japan Cherry Blossom</Text>
                                <View className="flex-row items-center gap-2 mt-1">
                                    <Calendar size={14} color="#90cacb" />
                                    <Text className="text-gray-400 text-xs">Apr 10 - May 02, 2023</Text>
                                </View>
                                <View className="flex-row items-center gap-1 mt-2">
                                    <View className="w-2 h-2 rounded-full bg-pink-400" />
                                    <Text className="text-xs text-gray-400">8 cities</Text>
                                </View>
                            </View>
                            <ChevronRight size={20} color="#6B7280" />
                        </GlassCard>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}
