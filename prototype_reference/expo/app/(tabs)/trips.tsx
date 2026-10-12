import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TripsScreen() {
    return (
        <SafeAreaView className="flex-1 bg-background-dark items-center justify-center">
            <Text className="text-white text-lg font-bold">Trips Screen</Text>
        </SafeAreaView>
    );
}
