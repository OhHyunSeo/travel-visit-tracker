import { View, ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { cssInterop } from 'nativewind';

cssInterop(BlurView, {
    className: {
        target: 'style',
    },
});

interface GlassCardProps extends ViewProps {
    intensity?: number;
    className?: string;
    children: React.ReactNode;
}

export function GlassCard({ intensity = 20, className, children, style, ...props }: GlassCardProps) {
    return (
        <View className={`overflow-hidden rounded-3xl border border-white/10 ${className}`} style={style} {...props}>
            <BlurView
                intensity={intensity}
                tint="dark"
                className="absolute inset-0"
            />
            {/* Background overlay for tint */}
            <View className="absolute inset-0 bg-surface" />

            <View className="p-4 relative z-10">
                {children}
            </View>
        </View>
    );
}
