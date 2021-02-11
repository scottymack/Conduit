export default {
    doc: 'Options for conduit payments provider',
    active: {
        format: 'Boolean',
        default: false
    },
    stripe: {
        enabled: {
            format: 'Boolean',
            default: false
        },
        secret_key: {
            format: 'String',
            default: undefined
        },
        subscriptions: {
            success_url: 'String',
            cancel_url: 'String'
        }
    },
    iamport: {
        enabled: {
            format: 'Boolean',
            default: false
        },
        api_key: {
            format: 'String',
            default: undefined
        },
        secret_key: {
            format: 'String',
            default: undefined
        }
    }
}
