import { Tabs } from 'expo-router';
import { View, Platform, StyleSheet } from 'react-native';
import { Home, Map, User, Plus, PlaneTakeoff } from 'lucide-react-native';
import { BlurView } from 'expo-blur';

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    position: 'absolute',
                    bottom: 25,
                    left: 20,
                    right: 20,
                    elevation: 0,
                    backgroundColor: 'transparent',
                    borderTopWidth: 0,
                    height: 64,
                    borderRadius: 20,
                    // Shadow for floating effect
                    ...Platform.select({
                        ios: {
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 10 },
                            shadowOpacity: 0.1,
                            shadowRadius: 10,
                        },
                        android: {
                            elevation: 5,
                        }
                    })
                },
                tabBarBackground: () => (
                    <BlurView
                        tint="dark"
                        intensity={40}
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: 20,
                                overflow: 'hidden',
                                borderWidth: 1,
                                borderColor: 'rgba(255,255,255,0.1)',
                                backgroundColor: 'rgba(24, 52, 52, 0.4)' // Glass-dark
                            }
                        ]}
                    />
                ),
                tabBarActiveTintColor: '#0ac4c7', // Primary
                tabBarInactiveTintColor: '#9CA3AF', // Gray-400
                tabBarShowLabel: true,
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '500',
                    marginBottom: 8, // Adjust for height
                },
                tabBarItemStyle: {
                    paddingTop: 8,
                }
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Home',
                    tabBarIcon: ({ color, size }) => <Home size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="map"
                options={{
                    title: 'Map',
                    tabBarIcon: ({ color, size }) => <Map size={24} color={color} />,
                }}
            />

            {/* Center FAB - Actual "Add" action */}
            <Tabs.Screen
                name="add"
                options={{
                    title: '',
                    tabBarIcon: ({ focused }) => (
                        <View style={{
                            top: -24, // Floating above
                            width: 64,
                            height: 64,
                            borderRadius: 32,
                            backgroundColor: '#0ac4c7',
                            justifyContent: 'center',
                            alignItems: 'center',
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#0ac4c7',
                                    shadowOffset: { width: 0, height: 0 },
                                    shadowOpacity: 0.5,
                                    shadowRadius: 10,
                                },
                                android: {
                                    elevation: 8,
                                },
                            })
                        }}>
                            <Plus size={32} color="white" />
                        </View>
                    ),
                    tabBarLabel: () => null,
                }}
                listeners={() => ({
                    tabPress: (e) => {
                        e.preventDefault();
                        console.log('Open Add Trip Modal');
                    },
                })}
            />

            <Tabs.Screen
                name="trips" // This file doesn't exist yet, we can map it to something or leave it as a placeholder
                options={{
                    title: 'Trips',
                    href: null, // Hide if no file, but design has 4 items? Design has Home, Map, Trips, Profile.
                    // The middle is FAB. So 5 items total layout: [Home, Map, FAB, Trips, Profile]
                    // But navigation usually has 4 + FAB.
                    // The design HTML shows: Home, Map, SPACE, Trips, Profile. 
                    // And FAB is absolutely positioned.
                    // My current implementation: [Home, Map, FAB(Item), Profile]. I am missing "Trips".
                    tabBarIcon: ({ color, size }) => <PlaneTakeoff size={24} color={color} />,
                }}
            />

            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profile',
                    tabBarIcon: ({ color, size }) => <User size={24} color={color} />,
                }}
            />
        </Tabs>
    );
}
