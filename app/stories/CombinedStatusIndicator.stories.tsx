import type { Meta, StoryObj } from '@storybook/react';
import CombinedStatusIndicator from '../components/CombinedStatusIndicator';
import { StatusProvider } from '../context/StatusContext';
import { Box } from '@mui/material';

const meta: Meta<typeof CombinedStatusIndicator> = {
    title: 'Indicators/CombinedStatusIndicator',
    component: CombinedStatusIndicator,
    decorators: [
        (Story) => (
            <StatusProvider>
                <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', bgcolor: 'background.default', minHeight: '100px' }}>
                    <Story />
                </Box>
            </StatusProvider>
        ),
    ],
    parameters: {
        layout: 'centered',
    },
};

export default meta;
type Story = StoryObj<typeof CombinedStatusIndicator>;

export const Default: Story = {};

export const Syncing: Story = {
    // Note: To truly test different states, we'd need to mock the StatusContext
    // For now, this just renders the component which will use the actual context values (or defaults)
};
