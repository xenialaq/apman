import _ from 'lodash';
import { props, nestedProps } from './types';

export const mergeKeyToProps: ((o: nestedProps) => props) = (o) => {
  const key = Object.keys(o)[0];
  const pobj = o[key] as props;
  return {
    ...pobj,
    id: Object.keys(o)[0].replace(/\D/g, ''),
  };
};

export const decodeURIComponentObj = (o: props) : props => _.mapValues(
  o,
  (v) => decodeURIComponent(v),
);
