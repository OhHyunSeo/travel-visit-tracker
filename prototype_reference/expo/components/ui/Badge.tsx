import { View, Text } from 'react-native';

interface BadgeProps {
    label: string;
    icon?: React.ReactNode;
    active?: boolean;
}

export function Badge({ label, icon, active = false }: BadgeProps) {
    return (
        <View className={`flex-row items-center px-3 py-1 rounded-full ${active ? 'bg-primary/20 border border-primary/30' : 'bg-white/10'}`}>
            {icon && <View className="mr-1">{icon}</View>}
            <Text className={`${active ? 'text-primary font-bold' : 'text-gray-300'} text-xs`}>
                {label}
            </Text>
        </View>
    );
}
