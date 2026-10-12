import { create } from 'zustand';

export interface Trip {
    id: string;
    title: string;
    date: string;
    image: any; // Using require() for static images in MVP
    stats: {
        stops?: number;
        cities?: number;
    };
}

interface TripState {
    activeTrip: Trip | null;
    recentTrips: Trip[];
    user: {
        name: string;
        tripsCount: number;
        countriesCount: number;
        kmCount: number;
    };
    setActiveTrip: (trip: Trip) => void;
}

export const useTripStore = create<TripState>((set) => ({
    activeTrip: {
        id: 'active-1',
        title: 'Exploring the Alps',
        date: 'Day 5',
        image: null, // Placeholder
        stats: {
            stops: 12,
        },
    },
    recentTrips: [
        {
            id: '1',
            title: 'Iceland Roadtrip',
            date: 'Nov 01 - Nov 12, 2023',
            image: null,
            stats: { stops: 12 },
        },
        {
            id: '2',
            title: 'Japan Cherry Blossom',
            date: 'Apr 10 - May 02, 2023',
            image: null,
            stats: { cities: 8 },
        },
    ],
    user: {
        name: 'Alex',
        tripsCount: 14,
        countriesCount: 26,
        kmCount: 42000,
    },
    setActiveTrip: (trip) => set({ activeTrip: trip }),
}));
