import { SetMetadata } from '@nestjs/common';

export const ALLOW_SCOPED_KEY = 'allowScoped';
/** RF-J14: lets a scoped (external-juror link) session reach this handler or controller. */
export const AllowScoped = () => SetMetadata(ALLOW_SCOPED_KEY, true);
